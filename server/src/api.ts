import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import {
  isAliasType,
  isCustomAlias,
  isMailboxAddress,
  isSourceAlias,
  normalizeAddress,
} from "./alias";
import { AppError, ConflictError, NotFoundError } from "./errors";
import type { AppConfig } from "./config";
import type { GmailSourceManager } from "./gmail/source-manager";
import type { MailboxStore, Message } from "./types";

function routeAddress(request: Request) {
  const rawAddress = request.params.address;
  if (typeof rawAddress !== "string") {
    throw new AppError(400, "INVALID_ADDRESS", "Mailbox address is required");
  }

  let address = rawAddress;
  try {
    address = decodeURIComponent(address);
  } catch {
    throw new AppError(400, "INVALID_ADDRESS", "Mailbox address is not valid URI encoding");
  }

  address = normalizeAddress(address);
  if (!isMailboxAddress(address)) {
    throw new AppError(400, "INVALID_ADDRESS", "Mailbox address is not valid");
  }
  return address;
}

function messageResponse(message: Message) {
  return {
    id: message.id,
    gmail_message_id: message.gmailMessageId,
    sender: message.sender,
    recipient: message.recipient,
    subject: message.subject,
    snippet: message.snippet,
    body_html: message.bodyHtml,
    body_text: message.bodyText,
    received_at: message.receivedAt,
    created_at: message.createdAt,
  };
}

function sourceReady(sourceManager: GmailSourceManager, sourceId: string) {
  return sourceManager.listHealth().then((sources) => sources.some((source) => source.id === sourceId && source.ready));
}

export function createApiRouter(store: MailboxStore, config: AppConfig, sourceManager: GmailSourceManager) {
  const router = Router();
  const mailboxLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  router.post("/mailboxes", async (request, response) => {
    const type = request.body?.type;
    if (!isAliasType(type)) {
      throw new AppError(400, "INVALID_TRICK_TYPE", "type must be dot, plus, mixed, or custom");
    }
    if (config.nodeEnv === "production" && !sourceManager.isReady()) {
      throw new AppError(503, "GMAIL_RELAY_NOT_READY", "No Gmail source is ready to receive mail yet");
    }

    const requestedAddress = typeof request.body?.address === "string" ? request.body.address.trim() : "";
    if (!requestedAddress) {
      throw new AppError(400, "ADDRESS_REQUIRED", "Generate the address in the browser before registering the mailbox");
    }

    let source = null as Awaited<ReturnType<MailboxStore["getGmailSource"]>>;
    let customDomain = null as Awaited<ReturnType<MailboxStore["getCustomDomain"]>>;
    let mailbox;

    const address = normalizeAddress(requestedAddress);
    if (!isMailboxAddress(address)) {
      throw new AppError(400, "INVALID_ADDRESS", "Mailbox address is not valid");
    }

    if (type === "custom") {
      const domainName = address.slice(address.lastIndexOf("@") + 1);
      customDomain = (await store.listCustomDomains()).find((entry) => entry.domain === domainName && entry.enabled) ?? null;
      if (!customDomain || !isCustomAlias(address, customDomain.domain)) {
        throw new AppError(400, "INVALID_ADDRESS", "Address is not registered under an active custom domain");
      }
      source = await store.getGmailSource(customDomain.sourceId);
    } else {
      const sources = await store.listGmailSources();
      source = sources.find((entry) => entry.status === "active" && isSourceAlias(address, entry.email, type)) ?? null;
    }

    if (!source) {
      throw new AppError(400, "INVALID_ADDRESS", "Address is not a valid alias of an active Gmail source");
    }
    if (!(await sourceReady(sourceManager, source.id))) {
      throw new AppError(503, "GMAIL_RELAY_NOT_READY", "The selected Gmail source is not ready");
    }
    if (await store.findMailboxByAddress(address)) {
      throw new ConflictError("Mailbox address is already registered");
    }
    try {
      mailbox = await store.createMailbox(address, type, source.id, customDomain?.id ?? null);
    } catch (error) {
      if (error instanceof ConflictError) {
        throw new ConflictError("Mailbox address is already registered");
      }
      throw error;
    }

    response.status(201).json({
      address: mailbox.address,
      type: mailbox.type,
      url: `/mailbox/#${encodeURIComponent(mailbox.address)}`,
    });
  });

  router.get("/mailboxes/:address/messages", mailboxLimiter, async (request, response) => {
    const address = routeAddress(request);
    const mailbox = await store.findMailboxByAddress(address);
    if (!mailbox) {
      throw new NotFoundError("Mailbox not found");
    }

    const messages = await store.listMessages(address, config.maxMessagesPerMailbox);
    response.json({
      mailbox: mailbox.address,
      messages: messages.map(messageResponse),
    });
  });

  router.delete("/messages/:id", mailboxLimiter, async (request, response) => {
    const id = request.params.id;
    if (typeof id !== "string") {
      throw new AppError(400, "INVALID_MESSAGE_ID", "Message id is required");
    }
    const deleted = await store.deleteMessage(id);
    if (!deleted) {
      throw new NotFoundError("Message not found");
    }
    response.status(204).send();
  });

  return router;
}
