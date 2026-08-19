import "dotenv/config";

export type AppConfig = {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  databaseUrl?: string;
  gmailClientId?: string;
  gmailClientSecret?: string;
  gmailRedirectUri?: string;
  gmailTokenEncryptionKey?: string;
  adminPasswordHash?: string;
  adminInitialPassword?: string;
  adminAppUrl?: string;
  adminSessionTtlHours: number;
  gmailRefreshToken?: string;
  gmailSourceEmail?: string;
  pollIntervalMs: number;
  messageRetentionDays: number;
  maxMessagesPerMailbox: number;
};

function numberFromEnv(name: string, fallback: number, minimum: number) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be a number greater than or equal to ${minimum}`);
  }
  return value;
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    port: numberFromEnv("PORT", 4000, 1),
    corsOrigins,
    databaseUrl: optionalEnv("DATABASE_URL"),
    gmailClientId: optionalEnv("GMAIL_CLIENT_ID"),
    gmailClientSecret: optionalEnv("GMAIL_CLIENT_SECRET"),
    gmailRedirectUri: optionalEnv("GMAIL_REDIRECT_URI"),
    gmailTokenEncryptionKey: optionalEnv("GMAIL_TOKEN_ENCRYPTION_KEY"),
    adminPasswordHash: optionalEnv("ADMIN_PASSWORD_HASH"),
    adminInitialPassword: optionalEnv("ADMIN_INITIAL_PASSWORD"),
    adminAppUrl: optionalEnv("ADMIN_APP_URL") ?? (nodeEnv === "development" ? "http://localhost:3000" : undefined),
    adminSessionTtlHours: numberFromEnv("ADMIN_SESSION_TTL_HOURS", 12, 1),
    gmailRefreshToken: optionalEnv("GMAIL_REFRESH_TOKEN"),
    gmailSourceEmail: optionalEnv("GMAIL_SOURCE_EMAIL")?.toLowerCase(),
    pollIntervalMs: numberFromEnv("POLL_INTERVAL_MS", 10_000, 1_000),
    messageRetentionDays: numberFromEnv("MESSAGE_RETENTION_DAYS", 7, 1),
    maxMessagesPerMailbox: numberFromEnv("MAX_MESSAGES_PER_MAILBOX", 20, 1),
  };
}

export function hasDatabaseConfig(config: AppConfig) {
  return Boolean(config.databaseUrl);
}
