import express from "express";
import next from "next";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { CleanupJob } from "./cleanup";
import { GmailSourceManager } from "./gmail/source-manager";
import { createStore } from "./store";

async function startIntegratedServer() {
  const config = loadConfig();
  const store = createStore(config);
  const cleanup = new CleanupJob(store, config);
  const sourceManager = new GmailSourceManager(store, config);
  await sourceManager.start();
  const apiApp = createApp(store, config, {
    includeNotFound: false,
    sourceManager,
  });
  const nextApp = next({
    dev: false,
    hostname: "0.0.0.0",
    port: config.port,
  });

  await nextApp.prepare();
  const handleNextRequest = nextApp.getRequestHandler();
  const app = express();
  app.use(apiApp);
  app.use((request, response) => {
    void handleNextRequest(request, response);
  });

  const server = app.listen(config.port, () => {
    console.info(`[INFO] Render web service listening on port ${config.port}`);
  });

  cleanup.start();

  const shutdown = (signal: string) => {
    console.info(`[INFO] ${signal} received; shutting down`);
    cleanup.stop();
    sourceManager.stop();
    void nextApp.close();
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

void startIntegratedServer().catch((error) => {
  console.error("[ERROR] Render web service failed to start", error);
  process.exitCode = 1;
});
