import type { gmail_v1 } from "googleapis";
import { extractRecipientCandidates, parseGmailMessage } from "./parser";
import type { AppConfig } from "../config";
import type { MailboxStore } from "../types";

const HISTORY_STATE_KEY = "gmail_history_id";

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }
  const value = error as { code?: number; response?: { status?: number }; status?: number };
  return value.response?.status ?? value.status ?? value.code ?? null;
}

export class GmailPoller {
  private timer: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(
    private readonly gmail: gmail_v1.Gmail,
    private readonly store: MailboxStore,
    private readonly config: AppConfig,
  ) {}

  async start() {
    if (this.timer) {
      return;
    }

    console.info("[INFO] Gmail polling started");
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
  }

  private async currentCheckpoint() {
    const saved = await this.store.getState(HISTORY_STATE_KEY);
    if (saved) {
      return saved;
    }

    const profile = await this.gmail.users.getProfile({ userId: "me" });
    const historyId = profile.data.historyId;
    if (!historyId) {
      throw new Error("Gmail profile did not return a historyId");
    }

    await this.store.setState(HISTORY_STATE_KEY, historyId);
    return historyId;
  }

  private async poll() {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    try {
      const checkpoint = await this.currentCheckpoint();
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
            await this.processMessage(messageId);
          }
        }

        pageToken = page.data.nextPageToken ?? undefined;
      } while (pageToken);

      if (latestHistoryId !== checkpoint) {
        await this.store.setState(HISTORY_STATE_KEY, latestHistoryId);
      }
    } catch (error) {
      if (errorStatus(error) === 404) {
        await this.resyncCheckpoint();
        console.warn("[WARN] Gmail history checkpoint expired; checkpoint resynced");
      } else {
        console.error("[ERROR] Gmail polling failed", error);
      }
    } finally {
      this.isPolling = false;
    }
  }

  private async resyncCheckpoint() {
    const profile = await this.gmail.users.getProfile({ userId: "me" });
    if (profile.data.historyId) {
      await this.store.setState(HISTORY_STATE_KEY, profile.data.historyId);
    }
  }

  private async processMessage(messageId: string) {
    const response = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const message = response.data;
    const recipients = extractRecipientCandidates(message.payload);

    for (const recipient of recipients) {
      const mailbox = await this.store.findMailboxByAddress(recipient);
      if (!mailbox) {
        continue;
      }

      const parsed = parseGmailMessage(message, mailbox.id, recipient);
      await this.store.insertMessage(parsed);
      await this.store.trimMailboxMessages(mailbox.id, this.config.maxMessagesPerMailbox);
      console.info(`[INFO] Message stored for mailbox ${mailbox.address}`);
      return;
    }
  }
}
