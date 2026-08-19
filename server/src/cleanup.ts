import type { AppConfig } from "./config";
import type { MailboxStore } from "./types";

export class CleanupJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly store: MailboxStore, private readonly config: AppConfig) {}

  start() {
    if (this.timer) {
      return;
    }

    void this.run();
    this.timer = setInterval(() => void this.run(), 60 * 60 * 1000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async run() {
    const before = new Date(Date.now() - this.config.messageRetentionDays * 24 * 60 * 60 * 1000);
    try {
      const deleted = await this.store.deleteExpiredMessages(before);
      console.info(`[INFO] Expired messages deleted: ${deleted}`);
    } catch (error) {
      console.error("[ERROR] Cleanup failed", error);
    }
  }
}
