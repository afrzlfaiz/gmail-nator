import { randomInt } from "node:crypto";
import type { MailboxStore, AliasType } from "./types";
import { ConflictError } from "./errors";

export function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

function sourceLocalPart(sourceEmail: string) {
  const [localPart, domain] = normalizeAddress(sourceEmail).split("@");
  if (!localPart || domain !== "gmail.com") {
    throw new Error("GMAIL_SOURCE_EMAIL must be a valid @gmail.com address");
  }
  return localPart.split("+")[0].replaceAll(".", "");
}

function randomTag(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += chars[randomInt(chars.length)];
  }
  return result;
}

function dotCandidate(localPart: string) {
  const forcedDotPosition = randomInt(1, localPart.length);
  let result = localPart[0];

  for (let index = 1; index < localPart.length; index += 1) {
    if (index === forcedDotPosition || randomInt(100) > 52) {
      result += ".";
    }
    result += localPart[index];
  }

  return `${result}@gmail.com`;
}

export function generateAlias(sourceEmail: string, type: AliasType) {
  const localPart = sourceLocalPart(sourceEmail);
  if (type === "dot") {
    return dotCandidate(localPart);
  }
  return `${localPart}+${randomTag()}@gmail.com`;
}

export function isAliasType(value: unknown): value is AliasType {
  return value === "dot" || value === "plus";
}

export function isGmailAddress(value: string) {
  return /^[a-z0-9][a-z0-9.+-]*@gmail\.com$/i.test(value);
}

export async function createUniqueMailbox(store: MailboxStore, sourceEmail: string, type: AliasType) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const address = normalizeAddress(generateAlias(sourceEmail, type));
    if (await store.findMailboxByAddress(address)) {
      continue;
    }

    try {
      return await store.createMailbox(address, type);
    } catch (error) {
      if (error instanceof ConflictError) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unable to generate a unique Gmail alias");
}
