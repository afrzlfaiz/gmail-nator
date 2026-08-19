import { domainToASCII } from "node:url";
import { randomInt } from "node:crypto";
import type { MailboxStore, AliasType } from "./types";
import { ConflictError } from "./errors";

const GMAIL_DOMAIN = "gmail.com";
const LOCAL_PART_PATTERN = /^[a-z0-9][a-z0-9.+-]*[a-z0-9]$/i;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normalizeDomain(domain: string) {
  const normalized = domainToASCII(domain.trim().toLowerCase()).replace(/\.$/, "");
  return normalized;
}

export function normalizeAddress(address: string) {
  const normalized = address.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex < 1) {
    return normalized;
  }

  return `${normalized.slice(0, atIndex)}@${normalizeDomain(normalized.slice(atIndex + 1))}`;
}

export function sourceLocalPart(sourceEmail: string) {
  const normalized = normalizeAddress(sourceEmail);
  const [localPart, domain] = normalized.split("@");
  if (!localPart || domain !== GMAIL_DOMAIN) {
    throw new Error("Gmail source must be a valid @gmail.com address");
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

function dottedLocalPart(localPart: string) {
  if (localPart.length < 2) {
    throw new Error("A Gmail source must have at least two local-part characters for dot aliases");
  }

  const forcedDotPosition = randomInt(1, localPart.length);
  let result = localPart[0];
  let hasDot = false;

  for (let index = 1; index < localPart.length; index += 1) {
    const canAddDot = index < localPart.length - 1 && !result.endsWith(".");
    const shouldAddDot = canAddDot && (index === forcedDotPosition || randomInt(100) > 52);
    if (shouldAddDot) {
      result += ".";
      hasDot = true;
    }
    result += localPart[index];
  }

  if (!hasDot) {
    const position = Math.min(forcedDotPosition, result.length - 1);
    result = `${result.slice(0, position)}.${result.slice(position)}`;
  }

  return result;
}

export function generateAlias(sourceEmail: string, type: AliasType, customDomain?: string) {
  const localPart = sourceLocalPart(sourceEmail);

  if (type === "dot") {
    return `${dottedLocalPart(localPart)}@${GMAIL_DOMAIN}`;
  }

  if (type === "plus") {
    return `${localPart}+${randomTag()}@${GMAIL_DOMAIN}`;
  }

  if (type === "mixed") {
    return `${dottedLocalPart(localPart)}+${randomTag()}@${GMAIL_DOMAIN}`;
  }

  if (!customDomain || !isValidDomain(customDomain)) {
    throw new Error("A valid custom domain is required for custom aliases");
  }
  return `${randomTag(10)}@${normalizeDomain(customDomain)}`;
}

export function isAliasType(value: unknown): value is AliasType {
  return value === "dot" || value === "plus" || value === "mixed" || value === "custom";
}

export function isGmailAddress(value: string) {
  const normalized = normalizeAddress(value);
  return LOCAL_PART_PATTERN.test(normalized.split("@")[0] ?? "") && normalized.endsWith(`@${GMAIL_DOMAIN}`);
}

export function isMailboxAddress(value: string) {
  const normalized = normalizeAddress(value);
  const [localPart, domain] = normalized.split("@");
  return Boolean(localPart && isValidDomain(domain ?? "") && LOCAL_PART_PATTERN.test(localPart));
}

export function isValidDomain(value: string) {
  return DOMAIN_PATTERN.test(normalizeDomain(value));
}

function isValidDotLocalPart(localPart: string) {
  return !localPart.startsWith(".") && !localPart.endsWith(".") && !localPart.includes("..") && LOCAL_PART_PATTERN.test(localPart);
}

export function isSourceAlias(address: string, sourceEmail: string, type?: AliasType) {
  const normalized = normalizeAddress(address);
  if (!isGmailAddress(normalized)) {
    return false;
  }

  const localPart = normalized.split("@")[0] ?? "";
  const plusIndex = localPart.indexOf("+");
  const prefix = plusIndex >= 0 ? localPart.slice(0, plusIndex) : localPart;
  const tag = plusIndex >= 0 ? localPart.slice(plusIndex + 1) : "";
  const base = sourceLocalPart(sourceEmail);
  const stripped = prefix.replaceAll(".", "");
  const hasDots = prefix.includes(".");
  const hasPlus = plusIndex >= 0 && tag.length > 0;

  if (stripped !== base || !isValidDotLocalPart(prefix)) {
    return false;
  }

  if (type === "dot") {
    return hasDots && !hasPlus;
  }
  if (type === "plus") {
    return !hasDots && hasPlus;
  }
  if (type === "mixed") {
    return hasDots && hasPlus;
  }

  return hasDots || hasPlus;
}

export function isCustomAlias(address: string, domain: string) {
  const normalized = normalizeAddress(address);
  const atIndex = normalized.lastIndexOf("@");
  return isMailboxAddress(normalized) && atIndex > 0 && normalized.slice(atIndex + 1) === normalizeDomain(domain);
}

export async function createUniqueMailbox(
  store: MailboxStore,
  sourceEmail: string,
  type: AliasType,
  sourceId: string,
  customDomain?: string,
  domainId?: string | null,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const address = normalizeAddress(generateAlias(sourceEmail, type, customDomain));
    if (await store.findMailboxByAddress(address)) {
      continue;
    }

    try {
      return await store.createMailbox(address, type, sourceId, domainId);
    } catch (error) {
      if (error instanceof ConflictError) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unable to generate a unique email alias");
}
