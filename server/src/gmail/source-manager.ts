import type { AppConfig } from "../config";
import { decryptSecret } from "../security";
import type { GmailSource, MailboxStore } from "../types";
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
}
