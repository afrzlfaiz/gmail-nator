import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { createApiRouter } from "./api";
import { AppError } from "./errors";
import { hasGmailConfig, type AppConfig } from "./config";
import type { MailboxStore } from "./types";

type AppOptions = {
  includeNotFound?: boolean;
};

export function createApp(store: MailboxStore, config: AppConfig, options: AppOptions = {}) {
  const app = express();

  app.disable("x-powered-by");
  // Next.js emits inline hydration scripts. Keep Helmet's security headers but
  // let Next control script policy for the integrated frontend response.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError(403, "CORS_FORBIDDEN", "Origin is not allowed"));
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", async (_request, response) => {
    await store.ping();
    response.json({
      status: "ok",
      storage: store.kind,
      gmailPollingConfigured: hasGmailConfig(config),
    });
  });

  app.use("/api", createApiRouter(store, config));

  if (options.includeNotFound !== false) {
    app.use((_request, response) => {
      response.status(404).json({ error: "NOT_FOUND", message: "Route not found" });
    });
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof AppError) {
      response.status(error.statusCode).json({ error: error.code, message: error.message });
      return;
    }

    console.error("[ERROR] API request failed", error);
    response.status(500).json({ error: "INTERNAL_ERROR", message: "An unexpected server error occurred" });
  };

  app.use(errorHandler);
  return app;
}
