import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { createUniqueMailbox, isAliasType, isGmailAddress, normalizeAddress } from "./alias";
import { AppError, NotFoundError } from "./errors";
import type { AppConfig } from "./config";
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
  if (!isGmailAddress(address)) {
    throw new AppError(400, "INVALID_ADDRESS", "Mailbox address must be a valid Gmail address");
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

export function createApiRouter(store: MailboxStore, config: AppConfig) {
  const router = Router();
  const generateLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "RATE_LIMITED", message: "Too many mailbox requests. Try again shortly." },
  });
  const mailboxLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  router.post("/mailboxes", generateLimiter, async (request, response) => {
    const type = request.body?.type;
    if (!isAliasType(type)) {
      throw new AppError(400, "INVALID_TRICK_TYPE", "type must be either dot or plus");
    }

    const mailbox = await createUniqueMailbox(store, config.gmailSourceEmail, type);
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

  router.get("/messages/:id", mailboxLimiter, async (request, response) => {
    const id = request.params.id;
    if (typeof id !== "string") {
      throw new AppError(400, "INVALID_MESSAGE_ID", "Message id is required");
    }
    const message = await store.getMessage(id);
    if (!message) {
      throw new NotFoundError("Message not found");
    }
    response.json(messageResponse(message));
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

  router.delete("/mailboxes/:address", generateLimiter, async (request, response) => {
    const address = routeAddress(request);
    const deleted = await store.deleteMailbox(address);
    if (!deleted) {
      throw new NotFoundError("Mailbox not found");
    }
    response.status(204).send();
  });

  return router;
}
