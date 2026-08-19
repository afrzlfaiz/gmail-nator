import { google } from "googleapis";
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { isGmailAddress, isValidDomain, normalizeAddress, normalizeDomain, sourceLocalPart } from "./alias";
import type { AppConfig } from "./config";
import { AppError, NotFoundError } from "./errors";
import { createSessionToken, encryptSecret, hashPassword, hashToken, verifyPassword } from "./security";
import type { MailboxStore, GmailSourceStatus } from "./types";
import type { GmailSourceManager } from "./gmail/source-manager";

const ADMIN_COOKIE = "gmail_nator_admin";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export type AdminRequest = Request & {
  adminSessionTokenHash?: string;
};

function cookieValue(request: Request) {
  const header = request.headers.cookie;
  if (!header) {
    return null;
  }
  const entry = header.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${ADMIN_COOKIE}=`));
  return entry?.slice(`${ADMIN_COOKIE}=`.length) || null;
}

function setAdminCookie(response: Response, token: string, maxAgeSeconds: number, secure: boolean) {
  const attributes = [
    `${ADMIN_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    attributes.push("Secure");
  }
  response.setHeader("Set-Cookie", attributes.join("; "));
}

function clearAdminCookie(response: Response, secure: boolean) {
  setAdminCookie(response, "", 0, secure);
}

function adminSourceResponse(source: Awaited<ReturnType<MailboxStore["getGmailSource"]>>) {
  if (!source) {
    return null;
  }
  return {
    id: source.id,
    email: source.email,
    label: source.label,
    status: source.status,
    hasRefreshToken: Boolean(source.refreshToken),
    historyId: source.historyId,
    lastPolledAt: source.lastPolledAt,
    lastError: source.lastError,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

async function ensureAdminPassword(store: MailboxStore, config: AppConfig) {
  const existing = await store.getAdminPasswordHash();
  if (existing) {
    return existing;
  }

  if (config.adminPasswordHash) {
    await store.setAdminPasswordHash(config.adminPasswordHash);
    return config.adminPasswordHash;
  }
  if (config.adminInitialPassword) {
    const hash = await hashPassword(config.adminInitialPassword);
    await store.setAdminPasswordHash(hash);
    console.warn("[WARN] Bootstrapped the admin password hash into the database; remove ADMIN_INITIAL_PASSWORD");
    return hash;
  }
  return null;
}

async function requireAdmin(request: AdminRequest, _response: Response, next: NextFunction, store: MailboxStore) {
  const token = cookieValue(request);
  if (!token) {
    throw new AppError(401, "ADMIN_UNAUTHORIZED", "Admin login is required");
  }

  const tokenHash = hashToken(token);
  const session = await store.getAdminSession(tokenHash);
  if (!session || new Date(session.expiresAt) <= new Date()) {
    await store.deleteAdminSession(tokenHash);
    throw new AppError(401, "ADMIN_UNAUTHORIZED", "Admin session has expired");
  }

  request.adminSessionTokenHash = tokenHash;
  next();
}

function ensureAllowedOrigin(request: Request, config: AppConfig) {
  const origin = request.headers.origin;
  if (origin && !config.corsOrigins.includes("*") && !config.corsOrigins.includes(origin)) {
    throw new AppError(403, "CORS_FORBIDDEN", "Origin is not allowed");
  }
}

function sourceId(request: Request) {
  const value = request.params.id;
  if (typeof value !== "string" || !value) {
    throw new AppError(400, "INVALID_SOURCE_ID", "Gmail source id is required");
  }
  return value;
}

function domainId(request: Request) {
  const value = request.params.id;
  if (typeof value !== "string" || !value) {
    throw new AppError(400, "INVALID_DOMAIN_ID", "Custom domain id is required");
  }
  return value;
}

export function createAdminRouter(store: MailboxStore, config: AppConfig, sourceManager: GmailSourceManager) {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "RATE_LIMITED", message: "Too many admin login attempts" },
  });

  router.post("/login", loginLimiter, async (request, response) => {
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const configuredHash = await ensureAdminPassword(store, config);
    if (!configuredHash || !(await verifyPassword(password, configuredHash))) {
      throw new AppError(401, "ADMIN_INVALID_CREDENTIALS", "Invalid admin password");
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + config.adminSessionTtlHours * 60 * 60 * 1000);
    await store.createAdminSession(hashToken(token), expiresAt);
    await store.deleteExpiredAdminSessions(new Date());
    setAdminCookie(response, token, config.adminSessionTtlHours * 60 * 60, config.nodeEnv === "production");
    response.json({ authenticated: true, expiresAt: expiresAt.toISOString() });
  });

  router.post("/logout", async (request, response) => {
    const token = cookieValue(request);
    if (token) {
      await store.deleteAdminSession(hashToken(token));
    }
    clearAdminCookie(response, config.nodeEnv === "production");
    response.status(204).send();
  });

  router.get("/session", async (request, response, next) => {
    try {
      await requireAdmin(request as AdminRequest, response, next, store);
      if (!response.headersSent) {
        response.json({ authenticated: true });
      }
    } catch (error) {
      next(error);
    }
  });

  router.use((request, response, next) => {
    void requireAdmin(request as AdminRequest, response, next, store).catch(next);
  });
  router.use((request, _response, next) => {
    try {
      ensureAllowedOrigin(request, config);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get("/sources", async (_request, response) => {
    const sources = await store.listGmailSources();
    response.json({ sources: sources.map(adminSourceResponse) });
  });

  router.post("/sources", async (request, response) => {
    const email = typeof request.body?.email === "string" ? normalizeAddress(request.body.email) : "";
    const label = typeof request.body?.label === "string" ? request.body.label.trim() || null : null;
    const refreshToken = typeof request.body?.refreshToken === "string" ? request.body.refreshToken.trim() : "";
    if (!isGmailAddress(email)) {
      throw new AppError(400, "INVALID_GMAIL_SOURCE", "Source must be a valid @gmail.com address");
    }
    sourceLocalPart(email);
    if (refreshToken && !config.gmailTokenEncryptionKey) {
      throw new AppError(503, "TOKEN_ENCRYPTION_NOT_CONFIGURED", "GMAIL_TOKEN_ENCRYPTION_KEY is required to save a refresh token");
    }
    const source = await store.createGmailSource(email, label);
    if (refreshToken) {
      await store.updateGmailSource(source.id, {
        refreshToken: encryptSecret(refreshToken, config.gmailTokenEncryptionKey!),
        status: "active",
      });
      await sourceManager.reload();
    }
    response.status(201).json({ source: adminSourceResponse(await store.getGmailSource(source.id)) });
  });

  router.post("/sources/:id/connect", async (request: AdminRequest, response) => {
    const id = sourceId(request);
    const source = await store.getGmailSource(id);
    if (!source) {
      throw new NotFoundError("Gmail source not found");
    }
    if (!config.gmailClientId || !config.gmailClientSecret || !config.gmailRedirectUri) {
      throw new AppError(503, "GOOGLE_OAUTH_NOT_CONFIGURED", "Google OAuth client configuration is incomplete");
    }
    if (!request.adminSessionTokenHash) {
      throw new AppError(401, "ADMIN_UNAUTHORIZED", "Admin login is required");
    }

    const state = randomBytes(32).toString("base64url");
    await store.createOAuthState(hashToken(state), request.adminSessionTokenHash, source.id, new Date(Date.now() + OAUTH_STATE_TTL_MS));
    const auth = new google.auth.OAuth2(config.gmailClientId, config.gmailClientSecret, config.gmailRedirectUri);
    const authUrl = auth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GMAIL_SCOPES,
      state,
    });
    response.json({ authUrl });
  });

  router.patch("/sources/:id", async (request, response) => {
    const id = sourceId(request);
    const source = await store.getGmailSource(id);
    if (!source) {
      throw new NotFoundError("Gmail source not found");
    }

    const patch: { label?: string | null; status?: GmailSourceStatus } = {};
    if (request.body?.label !== undefined) {
      patch.label = typeof request.body.label === "string" ? request.body.label.trim() || null : null;
    }
    if (request.body?.status !== undefined) {
      if (request.body.status !== "active" && request.body.status !== "disabled") {
        throw new AppError(400, "INVALID_SOURCE_STATUS", "Source status must be active or disabled");
      }
      if (request.body.status === "active" && !source.refreshToken) {
        throw new AppError(400, "SOURCE_NOT_CONNECTED", "Connect the Gmail source before enabling it");
      }
      patch.status = request.body.status;
    }

    const updated = await store.updateGmailSource(id, patch);
    await sourceManager.reload();
    response.json({ source: adminSourceResponse(updated) });
  });

  router.get("/status", async (_request, response) => {
    response.json({ sources: await sourceManager.listHealth() });
  });

  router.get("/domains", async (_request, response) => {
    const [domains, sources] = await Promise.all([store.listCustomDomains(), store.listGmailSources()]);
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    response.json({
      domains: domains.map((domain) => ({
        ...domain,
        sourceEmail: sourceMap.get(domain.sourceId)?.email ?? null,
      })),
    });
  });

  router.post("/domains", async (request, response) => {
    const domain = typeof request.body?.domain === "string" ? normalizeDomain(request.body.domain) : "";
    const targetSourceId = typeof request.body?.sourceId === "string" ? request.body.sourceId : "";
    if (!isValidDomain(domain)) {
      throw new AppError(400, "INVALID_CUSTOM_DOMAIN", "Custom domain is not valid");
    }
    const source = await store.getGmailSource(targetSourceId);
    if (!source) {
      throw new NotFoundError("Gmail source not found");
    }
    const customDomain = await store.createCustomDomain(domain, source.id);
    response.status(201).json({ domain: customDomain, sourceEmail: source.email });
  });

  router.patch("/domains/:id", async (request, response) => {
    const id = domainId(request);
    const domain = await store.getCustomDomain(id);
    if (!domain) {
      throw new NotFoundError("Custom domain not found");
    }
    const patch: { domain?: string; sourceId?: string; enabled?: boolean } = {};
    if (request.body?.domain !== undefined) {
      const value = typeof request.body.domain === "string" ? normalizeDomain(request.body.domain) : "";
      if (!isValidDomain(value)) {
        throw new AppError(400, "INVALID_CUSTOM_DOMAIN", "Custom domain is not valid");
      }
      patch.domain = value;
    }
    if (request.body?.sourceId !== undefined) {
      if (typeof request.body.sourceId !== "string" || !(await store.getGmailSource(request.body.sourceId))) {
        throw new NotFoundError("Gmail source not found");
      }
      patch.sourceId = request.body.sourceId;
    }
    if (request.body?.enabled !== undefined) {
      if (typeof request.body.enabled !== "boolean") {
        throw new AppError(400, "INVALID_DOMAIN_STATUS", "enabled must be a boolean");
      }
      patch.enabled = request.body.enabled;
    }
    const updated = await store.updateCustomDomain(id, patch);
    response.json({ domain: updated });
  });

  router.delete("/domains/:id", async (request, response) => {
    const id = domainId(request);
    const domain = await store.getCustomDomain(id);
    if (!domain) {
      throw new NotFoundError("Custom domain not found");
    }
    await store.updateCustomDomain(id, { enabled: false });
    response.status(204).send();
  });

  return router;
}

export function createOAuthCallbackHandler(store: MailboxStore, config: AppConfig, sourceManager: GmailSourceManager) {
  return async (request: Request, response: Response) => {
    const adminRedirect = (result: string) => response.redirect(`${config.adminAppUrl ?? ""}/admin?oauth=${result}`);
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const code = typeof request.query.code === "string" ? request.query.code : "";
    if (!state || !code) {
      adminRedirect("failed");
      return;
    }

    const oauthState = await store.consumeOAuthState(hashToken(state));
    if (!oauthState) {
      adminRedirect("expired");
      return;
    }
    const session = await store.getAdminSession(oauthState.sessionTokenHash);
    if (!session || new Date(session.expiresAt) <= new Date()) {
      adminRedirect("unauthorized");
      return;
    }

    try {
      if (!config.gmailClientId || !config.gmailClientSecret || !config.gmailRedirectUri || !config.gmailTokenEncryptionKey) {
        throw new Error("Google OAuth configuration is incomplete");
      }
      const source = await store.getGmailSource(oauthState.sourceId);
      if (!source) {
        throw new Error("Gmail source no longer exists");
      }
      const auth = new google.auth.OAuth2(config.gmailClientId, config.gmailClientSecret, config.gmailRedirectUri);
      const { tokens } = await auth.getToken(code);
      const refreshToken = tokens.refresh_token;
      if (!refreshToken && !source.refreshToken) {
        throw new Error("Google did not return a refresh token; revoke the existing grant and connect again");
      }
      if (tokens.access_token) {
        auth.setCredentials(tokens);
      } else if (refreshToken) {
        auth.setCredentials({ refresh_token: refreshToken });
      }
      const gmail = google.gmail({ version: "v1", auth });
      const profile = await gmail.users.getProfile({ userId: "me" });
      const connectedEmail = profile.data.emailAddress ? normalizeAddress(profile.data.emailAddress) : "";
      if (connectedEmail !== normalizeAddress(source.email)) {
        throw new Error(`Connected account ${connectedEmail || "unknown"} does not match ${source.email}`);
      }

      await store.updateGmailSource(source.id, {
        refreshToken: refreshToken ? encryptSecret(refreshToken, config.gmailTokenEncryptionKey) : source.refreshToken,
        status: "active",
        historyId: profile.data.historyId ?? null,
        lastError: null,
      });
      await sourceManager.reload();
      adminRedirect("connected");
    } catch (error) {
      console.error("[ERROR] Gmail OAuth callback failed", error);
      await store.updateGmailSource(oauthState.sourceId, {
        status: "reauth_required",
        lastError: error instanceof Error ? error.message : "OAuth callback failed",
      });
      adminRedirect("failed");
    }
  };
}
