import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { createApiRouter } from "./api";
import { createAdminRouter, createOAuthCallbackHandler } from "./admin";
import { AppError } from "./errors";
import { type AppConfig } from "./config";
import type { GmailSourceManager } from "./gmail/source-manager";
import type { MailboxStore } from "./types";

type AppOptions = {
  includeNotFound?: boolean;
  gmailRelayReady?: () => boolean;
  sourceManager: GmailSourceManager;
};

export function createApp(store: MailboxStore, config: AppConfig, options: AppOptions) {
  const app = express();

  app.disable("x-powered-by");
  // Next.js emits inline hydration scripts. Keep Helmet's security headers but
  // let Next control script policy for the integrated frontend response.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      credentials: true,
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
    const sources = await options.sourceManager.listHealth();
    const domains = await store.listCustomDomains();
    const readySourceIds = new Set(sources.filter((source) => source.ready).map((source) => source.id));
    response.json({
      status: "ok",
      storage: store.kind,
      gmailPollingConfigured: sources.length > 0,
      gmailRelayReady: options.sourceManager.isReady() || options.gmailRelayReady?.() || false,
      gmailSourceCount: readySourceIds.size,
      customDomainCount: domains.filter((domain) => domain.enabled && readySourceIds.has(domain.sourceId)).length,
    });
  });

  app.use("/api/admin", createAdminRouter(store, config, options.sourceManager));
  app.get("/oauth2/callback", createOAuthCallbackHandler(store, config, options.sourceManager));
  app.use("/api", createApiRouter(store, config, options.sourceManager));

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
