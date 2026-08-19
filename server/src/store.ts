import { randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";
import { normalizeAddress } from "./alias";
import { hasDatabaseConfig, type AppConfig } from "./config";
import { ConflictError } from "./errors";
import type { AliasType, Mailbox, MailboxStore, Message, NewMessage } from "./types";

type MailboxRow = {
  id: string;
  address: string;
  trick_type: AliasType;
  created_at: string;
};

type MessageRow = {
  id: string;
  mailbox_id: string;
  gmail_message_id: string;
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  snippet: string | null;
  body_html: string | null;
  body_text: string | null;
  received_at: string | null;
  created_at: string;
};

function mapMailbox(row: MailboxRow): Mailbox {
  return {
    id: row.id,
    address: row.address,
    type: row.trick_type,
    createdAt: row.created_at,
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    gmailMessageId: row.gmail_message_id,
    sender: row.sender,
    recipient: row.recipient,
    subject: row.subject,
    snippet: row.snippet,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    receivedAt: row.received_at,
    createdAt: row.created_at,
  };
}

function sortMessages(messages: Message[]) {
  return [...messages].sort((left, right) => {
    const receivedDifference = new Date(right.receivedAt ?? 0).getTime() - new Date(left.receivedAt ?? 0).getTime();
    if (receivedDifference !== 0) {
      return receivedDifference;
    }
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export class InMemoryStore implements MailboxStore {
  readonly kind = "memory" as const;
  private readonly mailboxes = new Map<string, Mailbox>();
  private readonly messages = new Map<string, Message & { mailboxId: string }>();
  private readonly appState = new Map<string, string>();

  async ping() {}

  async createMailbox(address: string, type: AliasType) {
    const normalized = normalizeAddress(address);
    if ([...this.mailboxes.values()].some((mailbox) => mailbox.address === normalized)) {
      throw new ConflictError("Mailbox address is already registered");
    }

    const mailbox: Mailbox = {
      id: randomUUID(),
      address: normalized,
      type,
      createdAt: new Date().toISOString(),
    };
    this.mailboxes.set(mailbox.id, mailbox);
    return mailbox;
  }

  async findMailboxByAddress(address: string) {
    return [...this.mailboxes.values()].find((mailbox) => mailbox.address === normalizeAddress(address)) ?? null;
  }

  async listMessages(address: string, limit: number) {
    const mailbox = await this.findMailboxByAddress(address);
    if (!mailbox) {
      return [];
    }

    return sortMessages([...this.messages.values()].filter((message) => message.mailboxId === mailbox.id)).slice(0, limit);
  }

  async getMessage(id: string) {
    const message = this.messages.get(id);
    return message ? { ...message } : null;
  }

  async insertMessage(input: NewMessage) {
    const existing = [...this.messages.values()].find((message) => message.gmailMessageId === input.gmailMessageId);
    if (existing) {
      return { ...existing };
    }

    const message: Message & { mailboxId: string } = {
      id: randomUUID(),
      mailboxId: input.mailboxId,
      gmailMessageId: input.gmailMessageId,
      sender: input.sender,
      recipient: input.recipient,
      subject: input.subject,
      snippet: input.snippet,
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText,
      receivedAt: input.receivedAt,
      createdAt: new Date().toISOString(),
    };
    this.messages.set(message.id, message);
    return { ...message };
  }

  async deleteMessage(id: string) {
    return this.messages.delete(id);
  }

  async deleteMailbox(address: string) {
    const mailbox = await this.findMailboxByAddress(address);
    if (!mailbox) {
      return false;
    }

    this.mailboxes.delete(mailbox.id);
    for (const [messageId, message] of this.messages) {
      if (message.mailboxId === mailbox.id) {
        this.messages.delete(messageId);
      }
    }
    return true;
  }

  async trimMailboxMessages(mailboxId: string, limit: number) {
    const mailboxMessages = sortMessages([...this.messages.values()].filter((message) => message.mailboxId === mailboxId));
    for (const message of mailboxMessages.slice(limit)) {
      this.messages.delete(message.id);
    }
  }

  async deleteExpiredMessages(before: Date) {
    let deleted = 0;
    for (const [messageId, message] of this.messages) {
      if (message.receivedAt && new Date(message.receivedAt) < before) {
        this.messages.delete(messageId);
        deleted += 1;
      }
    }
    return deleted;
  }

  async getState(key: string) {
    return this.appState.get(key) ?? null;
  }

  async setState(key: string, value: string) {
    this.appState.set(key, value);
  }

  async close() {}
}

export class PostgresStore implements MailboxStore {
  readonly kind = "postgres" as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      ssl: { rejectUnauthorized: false },
    });
    this.pool.on("error", (error) => console.error("[ERROR] PostgreSQL pool error", error));
  }

  private query<Row extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
    return this.pool.query<Row>(text, values);
  }

  async ping() {
    await this.query("select 1");
  }

  async createMailbox(address: string, type: AliasType) {
    try {
      const result = await this.query<MailboxRow>(
        `
          insert into public.mailboxes (address, trick_type)
          values ($1, $2)
          returning id, address, trick_type, created_at
        `,
        [normalizeAddress(address), type],
      );
      return mapMailbox(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("Mailbox address is already registered");
      }
      throw error;
    }
  }

  async findMailboxByAddress(address: string) {
    const result = await this.query<MailboxRow>(
      `select id, address, trick_type, created_at from public.mailboxes where lower(address) = lower($1) limit 1`,
      [normalizeAddress(address)],
    );
    return result.rows[0] ? mapMailbox(result.rows[0]) : null;
  }

  async listMessages(address: string, limit: number) {
    const result = await this.query<MessageRow>(
      `
        select id, mailbox_id, gmail_message_id, sender, recipient, subject, snippet,
               body_html, body_text, received_at, created_at
        from public.messages
        where mailbox_id = (
          select id from public.mailboxes where lower(address) = lower($1) limit 1
        )
        order by received_at desc nulls last, created_at desc
        limit $2
      `,
      [normalizeAddress(address), limit],
    );
    return result.rows.map(mapMessage);
  }

  async getMessage(id: string) {
    const result = await this.query<MessageRow>(
      `
        select id, mailbox_id, gmail_message_id, sender, recipient, subject, snippet,
               body_html, body_text, received_at, created_at
        from public.messages
        where id = $1
        limit 1
      `,
      [id],
    );
    return result.rows[0] ? mapMessage(result.rows[0]) : null;
  }

  async insertMessage(input: NewMessage) {
    const values = [
      input.mailboxId,
      input.gmailMessageId,
      input.sender,
      input.recipient,
      input.subject,
      input.snippet,
      input.bodyHtml,
      input.bodyText,
      input.receivedAt,
    ];
    const inserted = await this.query<MessageRow>(
      `
        insert into public.messages (
          mailbox_id, gmail_message_id, sender, recipient, subject, snippet,
          body_html, body_text, received_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (gmail_message_id) do nothing
        returning id, mailbox_id, gmail_message_id, sender, recipient, subject, snippet,
                  body_html, body_text, received_at, created_at
      `,
      values,
    );

    if (inserted.rows[0]) {
      return mapMessage(inserted.rows[0]);
    }

    const existing = await this.query<MessageRow>(
      `
        select id, mailbox_id, gmail_message_id, sender, recipient, subject, snippet,
               body_html, body_text, received_at, created_at
        from public.messages
        where gmail_message_id = $1
        limit 1
      `,
      [input.gmailMessageId],
    );
    if (!existing.rows[0]) {
      throw new Error("Message conflict could not be resolved");
    }
    return mapMessage(existing.rows[0]);
  }

  async deleteMessage(id: string) {
    const result = await this.query<{ id: string }>("delete from public.messages where id = $1 returning id", [id]);
    return Boolean(result.rows[0]);
  }

  async deleteMailbox(address: string) {
    const result = await this.query<{ id: string }>("delete from public.mailboxes where lower(address) = lower($1) returning id", [normalizeAddress(address)]);
    return Boolean(result.rows[0]);
  }

  async trimMailboxMessages(mailboxId: string, limit: number) {
    await this.query("select public.trim_mailbox_messages($1::uuid, $2::integer)", [mailboxId, limit]);
  }

  async deleteExpiredMessages(before: Date) {
    const result = await this.query<{ id: string }>("delete from public.messages where received_at < $1 returning id", [before]);
    return result.rows.length;
  }

  async getState(key: string) {
    const result = await this.query<{ value: string | null }>("select value from public.app_state where key = $1 limit 1", [key]);
    return result.rows[0]?.value ?? null;
  }

  async setState(key: string, value: string) {
    await this.query(
      `
        insert into public.app_state (key, value)
        values ($1, $2)
        on conflict (key) do update set value = excluded.value
      `,
      [key, value],
    );
  }

  async close() {
    await this.pool.end();
  }
}

export function createStore(config: AppConfig): MailboxStore {
  if (hasDatabaseConfig(config)) {
    console.info("[INFO] Using PostgreSQL via Supabase session pooler");
    return new PostgresStore(config.databaseUrl!);
  }

  console.warn("[WARN] DATABASE_URL is missing; using in-memory storage");
  return new InMemoryStore();
}
