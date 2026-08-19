import type { AliasType } from "./alias-relay-types";

const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomIndex(maximum: number) {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  // ponytail: modulo bias is irrelevant for disposable aliases; use rejection sampling if alias entropy becomes security-sensitive.
  return values[0] % maximum;
}

function randomTag(length: number) {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += CHARS[randomIndex(CHARS.length)];
  }
  return result;
}

function dottedLocalPart(localPart: string) {
  if (localPart.length < 2) {
    throw new Error("The Gmail source is too short for a dot alias");
  }

  const forcedDotPosition = randomIndex(localPart.length - 1) + 1;
  let result = localPart[0];
  let hasDot = false;

  for (let index = 1; index < localPart.length; index += 1) {
    const canAddDot = index < localPart.length - 1 && !result.endsWith(".");
    const shouldAddDot = canAddDot && (index === forcedDotPosition || randomIndex(100) > 52);
    if (shouldAddDot) {
      result += ".";
      hasDot = true;
    }
    result += localPart[index];
  }

  if (!hasDot) {
    result = `${result.slice(0, forcedDotPosition)}.${result.slice(forcedDotPosition)}`;
  }
  return result;
}

export function generateAlias(type: AliasType, sourceLocalParts: string[], customDomains: string[]) {
  if (type === "custom") {
    if (!customDomains.length) {
      throw new Error("No custom domain is ready");
    }
    return `${randomTag(10)}@${customDomains[randomIndex(customDomains.length)]}`;
  }

  if (!sourceLocalParts.length) {
    throw new Error("No Gmail source is ready");
  }

  const localPart = sourceLocalParts[randomIndex(sourceLocalParts.length)];
  if (type === "plus") {
    return `${localPart}+${randomTag(6)}@gmail.com`;
  }

  const dotted = dottedLocalPart(localPart);
  return type === "mixed" ? `${dotted}+${randomTag(6)}@gmail.com` : `${dotted}@gmail.com`;
}
