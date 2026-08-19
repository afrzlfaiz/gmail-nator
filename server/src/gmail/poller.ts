import type { gmail_v1 } from "googleapis";
import { extractRecipientCandidates, parseGmailMessage } from "./parser";
import type { AppConfig } from "../config";
import { normalizeAddress } from "../alias";
import type { GmailSource, MailboxStore } from "../types";

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }
  const value = error as { code?: number; response?: { status?: number }; status?: number };
  return value.response?.status ?? value.status ?? value.code ?? null;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Gmail polling failed";
}

export class GmailPoller {
  private timer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private relayReady = false;

  constructor(
    private readonly gmail: gmail_v1.Gmail,
    private readonly store: MailboxStore,
    private readonly config: AppConfig,
    private readonly sourceId: string,
  ) {}

  async start() {
    if (this.timer) {
      return;
    }

    const source = await this.store.getGmailSource(this.sourceId);
    console.info(`[INFO] Gmail polling started for ${source?.email ?? this.sourceId}`);
    try {
      await this.poll();
    } catch (error) {
      console.error("[ERROR] Initial Gmail poll failed", error);
    }

    this.timer = setInterval(() => void this.poll(), this.config.pollIntervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.relayReady = false;
  }

  isReady() {
    return this.relayReady;
  }

  private async currentCheckpoint(source: GmailSource) {
    if (source.historyId) {
      return source.historyId;
    }

    const profile = await this.gmail.users.getProfile({ userId: "me" });
    const profileEmail = profile.data.emailAddress ? normalizeAddress(profile.data.emailAddress) : null;
    if (profileEmail && profileEmail !== normalizeAddress(source.email)) {
      throw new Error(`OAuth account ${profileEmail} does not match configured source ${source.email}`);
    }

    const historyId = profile.data.historyId;
    if (!historyId) {
      throw new Error("Gmail profile did not return a historyId");
    }

    await this.store.updateGmailSource(source.id, { historyId });
    return historyId;
  }

  private async poll() {
    if (this.isPolling) {
      return;
    }

    const source = await this.store.getGmailSource(this.sourceId);
    if (!source || source.status !== "active") {
      this.relayReady = false;
      return;
    }

    this.isPolling = true;
    try {
      const checkpoint = await this.currentCheckpoint(source);
      let pageToken: string | undefined;
      let latestHistoryId = checkpoint;
      const processedIds = new Set<string>();

      do {
        const page = await this.gmail.users.history.list({
          userId: "me",
          startHistoryId: checkpoint,
          historyTypes: ["messageAdded"],
          pageToken,
        });
        latestHistoryId = page.data.historyId ?? latestHistoryId;

        for (const historyRecord of page.data.history ?? []) {
          const addedMessages = [
            ...(historyRecord.messagesAdded ?? []).map((entry) => entry.message),
            ...(historyRecord.messages ?? []),
          ];
          for (const message of addedMessages) {
            const messageId = message?.id;
            if (!messageId || processedIds.has(messageId)) {
              continue;
            }
            processedIds.add(messageId);
            await this.processMessage(messageId, source);
          }
        }

        pageToken = page.data.nextPageToken ?? undefined;
      } while (pageToken);

      await this.store.updateGmailSource(source.id, {
        historyId: latestHistoryId,
        status: "active",
        lastError: null,
        lastPolledAt: new Date().toISOString(),
      });
      this.relayReady = true;
    } catch (error) {
      this.relayReady = false;
      const status = errorStatus(error);
      const reauthRequired = status === 401 || status === 400 && errorMessage(error).toLowerCase().includes("invalid_grant");
      await this.store.updateGmailSource(this.sourceId, {
        status: reauthRequired ? "reauth_required" : "error",
        lastError: errorMessage(error),
        lastPolledAt: new Date().toISOString(),
      });

      if (status === 404) {
        await this.resyncCheckpoint();
        console.warn(`[WARN] Gmail history checkpoint expired for source ${this.sourceId}; checkpoint resynced`);
      } else {
        console.error(`[ERROR] Gmail polling failed for source ${this.sourceId}`, error);
      }
    } finally {
      this.isPolling = false;
    }
  }

  private async resyncCheckpoint() {
    const profile = await this.gmail.users.getProfile({ userId: "me" });
    if (profile.data.historyId) {
      await this.store.updateGmailSource(this.sourceId, {
        historyId: profile.data.historyId,
        status: "active",
        lastError: null,
      });
    }
  }

  private async processMessage(messageId: string, source: GmailSource) {
    const response = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const message = response.data;
    const recipients = [...new Set(extractRecipientCandidates(message.payload))];

    for (const recipient of recipients) {
      const mailbox = await this.store.findMailboxByAddress(recipient);
      if (!mailbox) {
        continue;
      }

      if (mailbox.sourceId !== source.id) {
        continue;
      }

      const parsed = parseGmailMessage(message, mailbox.id, source.id, recipient);
      await this.store.insertMessage(parsed);
      await this.store.trimMailboxMessages(mailbox.id, this.config.maxMessagesPerMailbox);
      console.info(`[INFO] Message stored for mailbox ${mailbox.address}`);
    }
  }
}
