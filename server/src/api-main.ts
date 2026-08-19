import { createApp } from "./app";
import { loadConfig } from "./config";
import { CleanupJob } from "./cleanup";
import { GmailSourceManager } from "./gmail/source-manager";
import { createStore } from "./store";

export async function startApiServer() {
  const config = loadConfig();
  const store = createStore(config);
  const cleanup = new CleanupJob(store, config);
  const sourceManager = new GmailSourceManager(store, config);
  await sourceManager.start();
  const app = createApp(store, config, {
    sourceManager,
  });
  const server = app.listen(config.port, () => {
    console.info(`[INFO] API listening on port ${config.port}`);
  });

  cleanup.start();

  const shutdown = (signal: string) => {
    console.info(`[INFO] ${signal} received; shutting down`);
    cleanup.stop();
    sourceManager.stop();
    server.close((error) => {
      void store.close().finally(() => {
        if (error) {
          console.error("[ERROR] API shutdown failed", error);
          process.exitCode = 1;
        }
        process.exit();
      });
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

void startApiServer().catch((error) => {
  console.error("[ERROR] API failed to start", error);
  process.exitCode = 1;
});
