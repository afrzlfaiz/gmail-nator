import type { gmail_v1 } from "googleapis";
import { normalizeAddress } from "../alias";
import type { NewMessage } from "../types";

type GmailPayload = gmail_v1.Schema$MessagePart;

function headerValue(payload: GmailPayload | undefined, name: string) {
  return payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? null;
}

function emailAddresses(value: string) {
  return [...value.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)].map((match) => normalizeAddress(match[0]));
}

export function extractRecipientCandidates(payload: GmailPayload | undefined) {
  const candidates: string[] = [];
  const preferredHeaders = ["delivered-to", "x-original-to", "envelope-to", "to"];

  for (const name of preferredHeaders) {
    const value = headerValue(payload, name);
    if (!value) {
      continue;
    }
    for (const address of emailAddresses(value)) {
      if (!candidates.includes(address)) {
        candidates.push(address);
      }
    }
  }

  return candidates;
}

function decodeBody(data: string | null | undefined) {
  if (!data) {
    return "";
  }

  const normalized = data.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function collectBodies(payload: GmailPayload | undefined) {
  const bodies = { text: "", html: "" };
  const visit = (part: GmailPayload | undefined) => {
    if (!part) {
      return;
    }

    const content = decodeBody(part.body?.data);
    if (part.mimeType === "text/plain" && content && !bodies.text) {
      bodies.text = content;
    }
    if (part.mimeType === "text/html" && content && !bodies.html) {
      bodies.html = content;
    }

    for (const child of part.parts ?? []) {
      visit(child);
    }
  };

  visit(payload);
  return bodies;
}

export function parseGmailMessage(message: gmail_v1.Schema$Message, mailboxId: string, recipient: string): NewMessage {
  if (!message.id) {
    throw new Error("Gmail message is missing its id");
  }

  const bodies = collectBodies(message.payload);
  const receivedAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString();

  return {
    mailboxId,
    gmailMessageId: message.id,
    sender: headerValue(message.payload, "from"),
    recipient: normalizeAddress(recipient),
    subject: headerValue(message.payload, "subject"),
    snippet: message.snippet ?? null,
    bodyHtml: bodies.html || null,
    bodyText: bodies.text || null,
    receivedAt,
  };
}
