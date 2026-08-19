import { createApp } from "./app";
import { hasGmailConfig, loadConfig } from "./config";
import { CleanupJob } from "./cleanup";
import { createGmailClient } from "./gmail/client";
import { GmailPoller } from "./gmail/poller";
import { createStore } from "./store";

const config = loadConfig();
const store = createStore(config);
const app = createApp(store, config);
const cleanup = new CleanupJob(store, config);
const poller = hasGmailConfig(config) ? new GmailPoller(createGmailClient(config), store, config) : null;

const server = app.listen(config.port, () => {
  console.info(`[INFO] API listening on port ${config.port}`);
  if (!poller) {
    console.warn("[WARN] Gmail polling disabled; OAuth environment variables are incomplete");
  }
});

cleanup.start();
if (poller) {
  void poller.start();
}

function shutdown(signal: string) {
  console.info(`[INFO] ${signal} received; shutting down`);
  cleanup.stop();
  poller?.stop();
  server.close((error) => {
    if (error) {
      console.error("[ERROR] API shutdown failed", error);
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
