import { randomInt } from "node:crypto";
import type { AppConfig } from "../config";
import { normalizeAddress } from "../alias";
import { ConflictError } from "../errors";
import { decryptSecret, encryptSecret } from "../security";
import type { CustomDomain, GmailSource, MailboxStore } from "../types";
import { createGmailClient } from "./client";
import { GmailPoller } from "./poller";

export type SourceHealth = {
  id: string;
  email: string;
  label: string | null;
  status: GmailSource["status"];
  ready: boolean;
  hasRefreshToken: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
};

export class GmailSourceManager {
  private readonly pollers = new Map<string, GmailPoller>();

  constructor(private readonly store: MailboxStore, private readonly config: AppConfig) {}

  async start() {
    await this.bootstrapLegacySource();
    await this.reload();
  }

  async reload() {
    this.stop();
    if (!this.config.gmailClientId || !this.config.gmailClientSecret) {
      console.warn("[WARN] Gmail OAuth client credentials are incomplete; Gmail polling is disabled");
      return;
    }

    const sources = await this.store.listGmailSources();
    await Promise.all(
      sources
        .filter((source) => source.status === "active" && source.refreshToken)
        .map(async (source) => {
          try {
            if (!this.config.gmailTokenEncryptionKey || !source.refreshToken) {
              throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is required for Gmail source polling");
            }
            const refreshToken = decryptSecret(source.refreshToken, this.config.gmailTokenEncryptionKey);
            const poller = new GmailPoller(createGmailClient(this.config, refreshToken), this.store, this.config, source.id);
            this.pollers.set(source.id, poller);
            await poller.start();
          } catch (error) {
            await this.store.updateGmailSource(source.id, {
              status: "error",
              lastError: error instanceof Error ? error.message : "Unable to initialize Gmail source",
            });
            console.error(`[ERROR] Unable to initialize Gmail source ${source.email}`, error);
          }
        }),
    );
  }

  stop() {
    for (const poller of this.pollers.values()) {
      poller.stop();
    }
    this.pollers.clear();
  }

  isReady() {
    return [...this.pollers.values()].some((poller) => poller.isReady());
  }

  async listHealth(): Promise<SourceHealth[]> {
    const sources = await this.store.listGmailSources();
    return sources.map((source) => ({
      id: source.id,
      email: source.email,
      label: source.label,
      status: source.status,
      ready: this.pollers.get(source.id)?.isReady() ?? false,
      hasRefreshToken: Boolean(source.refreshToken),
      lastPolledAt: source.lastPolledAt,
      lastError: source.lastError,
    }));
  }

  async pickRandomSource() {
    const sources = await this.store.listGmailSources();
    const readySources = sources.filter((source) => source.status === "active" && this.pollers.get(source.id)?.isReady());
    return readySources.length ? readySources[randomInt(readySources.length)] : null;
  }

  async pickRandomCustomDomain() {
    const domains = await this.store.listCustomDomains();
    const eligible = [] as Array<{ domain: CustomDomain; source: GmailSource }>;
    for (const domain of domains) {
      if (!domain.enabled) {
        continue;
      }
      const source = await this.store.getGmailSource(domain.sourceId);
      if (source?.status === "active" && this.pollers.get(source.id)?.isReady()) {
        eligible.push({ domain, source });
      }
    }
    return eligible.length ? eligible[randomInt(eligible.length)] : null;
  }

  async sourceForEmail(email: string) {
    const normalized = normalizeAddress(email);
    const sources = await this.store.listGmailSources();
    return sources.find((source) => source.email === normalized && source.status === "active") ?? null;
  }

  private async bootstrapLegacySource() {
    if (!this.config.gmailSourceEmail || !this.config.gmailRefreshToken) {
      return;
    }

    const sources = await this.store.listGmailSources();
    const normalizedEmail = normalizeAddress(this.config.gmailSourceEmail);
    let source = sources.find((entry) => entry.email === normalizedEmail) ?? null;
    if (source?.refreshToken) {
      return;
    }
    if (!this.config.gmailTokenEncryptionKey) {
      throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is required to migrate the legacy Gmail refresh token");
    }

    if (!source) {
      try {
        source = await this.store.createGmailSource(normalizedEmail, "Legacy Gmail source");
      } catch (error) {
        if (!(error instanceof ConflictError)) {
          throw error;
        }
        source = (await this.store.listGmailSources()).find((entry) => entry.email === normalizedEmail) ?? null;
      }
    }
    if (!source) {
      throw new Error("Unable to create the legacy Gmail source");
    }

    await this.store.updateGmailSource(source.id, {
      refreshToken: encryptSecret(this.config.gmailRefreshToken, this.config.gmailTokenEncryptionKey),
      status: "active",
      lastError: null,
    });
    await this.store.backfillLegacySource(source.id);
    console.warn("[WARN] Migrated legacy Gmail environment credentials into the database; remove GMAIL_SOURCE_EMAIL and GMAIL_REFRESH_TOKEN");
  }
}
