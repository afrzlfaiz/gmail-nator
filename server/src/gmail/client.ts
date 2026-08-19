import { google, type gmail_v1 } from "googleapis";
import type { AppConfig } from "../config";

export function createGmailClient(config: AppConfig, refreshToken: string): gmail_v1.Gmail {
  if (!config.gmailClientId || !config.gmailClientSecret || !refreshToken) {
    throw new Error("Gmail OAuth configuration is incomplete");
  }

  const auth = new google.auth.OAuth2(config.gmailClientId, config.gmailClientSecret, config.gmailRedirectUri);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
}
