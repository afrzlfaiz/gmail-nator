import { domainToASCII } from "node:url";
import type { AliasType } from "./types";

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

export function isAliasType(value: unknown): value is AliasType {
  return value === "dot" || value === "plus" || value === "mixed" || value === "custom";
}

export function isGmailAddress(value: string) {
  return isMailboxAddress(value) && value.endsWith(`@${GMAIL_DOMAIN}`);
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
