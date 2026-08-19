import { Pool, type QueryResultRow } from "pg";
import { normalizeAddress } from "./alias";
import { hasDatabaseConfig, type AppConfig } from "./config";
import { ConflictError } from "./errors";
import type {
  AliasType,
  CustomDomain,
  CustomDomainPatch,
  EncryptedSecret,
  GmailSource,
  GmailSourcePatch,
  Mailbox,
  MailboxStore,
  Message,
  NewMessage,
} from "./types";

type MailboxRow = {
  id: string;
  address: string;
  trick_type: AliasType;
  source_id: string | null;
  domain_id: string | null;
  created_at: string | Date;
};

type MessageRow = {
  id: string;
  source_id: string | null;
  mailbox_id: string;
  gmail_message_id: string;
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  snippet: string | null;
  body_html: string | null;
  body_text: string | null;
  received_at: string | Date | null;
  created_at: string | Date;
};

type GmailSourceRow = {
  id: string;
  email: string;
  label: string | null;
  status: GmailSource["status"];
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  refresh_token_tag: string | null;
  history_id: string | null;
  last_polled_at: string | Date | null;
  last_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type CustomDomainRow = {
  id: string;
  domain: string;
  source_id: string;
  enabled: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

function timestamp(value: string | Date | null) {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function mapMailbox(row: MailboxRow): Mailbox {
  return {
    id: row.id,
    address: row.address,
    type: row.trick_type,
    sourceId: row.source_id,
    domainId: row.domain_id,
    createdAt: timestamp(row.created_at) ?? new Date().toISOString(),
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sourceId: row.source_id,
    gmailMessageId: row.gmail_message_id,
    sender: row.sender,
    recipient: row.recipient,
    subject: row.subject,
    snippet: row.snippet,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    receivedAt: timestamp(row.received_at),
    createdAt: timestamp(row.created_at) ?? new Date().toISOString(),
  };
}

function mapSecret(row: GmailSourceRow): EncryptedSecret | null {
  if (!row.refresh_token_ciphertext || !row.refresh_token_iv || !row.refresh_token_tag) {
    return null;
  }
  return {
    ciphertext: row.refresh_token_ciphertext,
    iv: row.refresh_token_iv,
    tag: row.refresh_token_tag,
  };
}

function mapGmailSource(row: GmailSourceRow): GmailSource {
  return {
    id: row.id,
    email: row.email,
    label: row.label,
    status: row.status,
    refreshToken: mapSecret(row),
    historyId: row.history_id,
    lastPolledAt: timestamp(row.last_polled_at),
    lastError: row.last_error,
    createdAt: timestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: timestamp(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapCustomDomain(row: CustomDomainRow): CustomDomain {
  return {
    id: row.id,
    domain: row.domain,
    sourceId: row.source_id,
    enabled: row.enabled,
    createdAt: timestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: timestamp(row.updated_at) ?? new Date().toISOString(),
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

const MESSAGE_COLUMNS = `
  id, source_id, mailbox_id, gmail_message_id, sender, recipient, subject, snippet,
  body_html, body_text, received_at, created_at
`;

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

  async createMailbox(address: string, type: AliasType, sourceId: string, domainId: string | null = null) {
    try {
      const result = await this.query<MailboxRow>(
        `
          insert into public.mailboxes (address, trick_type, source_id, domain_id)
          values ($1, $2, $3, $4)
          returning id, address, trick_type, source_id, domain_id, created_at
        `,
        [normalizeAddress(address), type, sourceId, domainId],
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
      `select id, address, trick_type, source_id, domain_id, created_at from public.mailboxes where lower(address) = lower($1) limit 1`,
      [normalizeAddress(address)],
    );
    return result.rows[0] ? mapMailbox(result.rows[0]) : null;
  }

  async listMessages(address: string, limit: number) {
    const result = await this.query<MessageRow>(
      `
        select ${MESSAGE_COLUMNS}
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

  async insertMessage(input: NewMessage) {
    const values = [
      input.sourceId,
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
          source_id, mailbox_id, gmail_message_id, sender, recipient, subject, snippet,
          body_html, body_text, received_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict do nothing
        returning ${MESSAGE_COLUMNS}
      `,
      values,
    );

    if (inserted.rows[0]) {
      return mapMessage(inserted.rows[0]);
    }

    const existing = await this.query<MessageRow>(
      `
        select ${MESSAGE_COLUMNS}
        from public.messages
        where source_id = $1 and gmail_message_id = $2 and mailbox_id = $3
        limit 1
      `,
      [input.sourceId, input.gmailMessageId, input.mailboxId],
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

  async trimMailboxMessages(mailboxId: string, limit: number) {
    await this.query("select public.trim_mailbox_messages($1::uuid, $2::integer)", [mailboxId, limit]);
  }

  async deleteExpiredMessages(before: Date) {
    const result = await this.query<{ id: string }>("delete from public.messages where received_at < $1 returning id", [before]);
    return result.rows.length;
  }

  async listGmailSources() {
    const result = await this.query<GmailSourceRow>(
      `
        select id, email, label, status, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
               history_id, last_polled_at, last_error, created_at, updated_at
        from public.gmail_sources
        order by created_at asc
      `,
    );
    return result.rows.map(mapGmailSource);
  }

  async getGmailSource(id: string) {
    const result = await this.query<GmailSourceRow>(
      `
        select id, email, label, status, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
               history_id, last_polled_at, last_error, created_at, updated_at
        from public.gmail_sources where id = $1 limit 1
      `,
      [id],
    );
    return result.rows[0] ? mapGmailSource(result.rows[0]) : null;
  }

  async createGmailSource(email: string, label: string | null = null) {
    try {
      const result = await this.query<GmailSourceRow>(
        `
          insert into public.gmail_sources (email, label)
          values ($1, $2)
          returning id, email, label, status, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
                    history_id, last_polled_at, last_error, created_at, updated_at
        `,
        [normalizeAddress(email), label],
      );
      return mapGmailSource(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("Gmail source is already registered");
      }
      throw error;
    }
  }

  async updateGmailSource(id: string, patch: GmailSourcePatch) {
    const updates: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      updates.push(`${column} = $${values.length + 1}`);
      values.push(value);
    };

    if (patch.email !== undefined) add("email", normalizeAddress(patch.email));
    if (patch.label !== undefined) add("label", patch.label);
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.historyId !== undefined) add("history_id", patch.historyId);
    if (patch.lastPolledAt !== undefined) add("last_polled_at", patch.lastPolledAt);
    if (patch.lastError !== undefined) add("last_error", patch.lastError);
    if (patch.refreshToken !== undefined) {
      add("refresh_token_ciphertext", patch.refreshToken?.ciphertext ?? null);
      add("refresh_token_iv", patch.refreshToken?.iv ?? null);
      add("refresh_token_tag", patch.refreshToken?.tag ?? null);
    }

    if (!updates.length) {
      return this.getGmailSource(id);
    }

    add("updated_at", new Date());
    values.push(id);
    const result = await this.query<GmailSourceRow>(
      `
        update public.gmail_sources
        set ${updates.join(", ")}
        where id = $${values.length}
        returning id, email, label, status, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
                  history_id, last_polled_at, last_error, created_at, updated_at
      `,
      values,
    );
    return result.rows[0] ? mapGmailSource(result.rows[0]) : null;
  }

  async listCustomDomains() {
    const result = await this.query<CustomDomainRow>(
      `select id, domain, source_id, enabled, created_at, updated_at from public.custom_domains order by created_at asc`,
    );
    return result.rows.map(mapCustomDomain);
  }

  async getCustomDomain(id: string) {
    const result = await this.query<CustomDomainRow>(
      `select id, domain, source_id, enabled, created_at, updated_at from public.custom_domains where id = $1 limit 1`,
      [id],
    );
    return result.rows[0] ? mapCustomDomain(result.rows[0]) : null;
  }

  async createCustomDomain(domain: string, sourceId: string) {
    try {
      const result = await this.query<CustomDomainRow>(
        `
          insert into public.custom_domains (domain, source_id)
          values ($1, $2)
          returning id, domain, source_id, enabled, created_at, updated_at
        `,
        [domain.trim().toLowerCase(), sourceId],
      );
      return mapCustomDomain(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("Custom domain is already registered");
      }
      throw error;
    }
  }

  async updateCustomDomain(id: string, patch: CustomDomainPatch) {
    const updates: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      updates.push(`${column} = $${values.length + 1}`);
      values.push(value);
    };

    if (patch.domain !== undefined) add("domain", patch.domain.trim().toLowerCase());
    if (patch.sourceId !== undefined) add("source_id", patch.sourceId);
    if (patch.enabled !== undefined) add("enabled", patch.enabled);
    if (!updates.length) {
      return this.getCustomDomain(id);
    }

    add("updated_at", new Date());
    values.push(id);
    const result = await this.query<CustomDomainRow>(
      `
        update public.custom_domains
        set ${updates.join(", ")}
        where id = $${values.length}
        returning id, domain, source_id, enabled, created_at, updated_at
      `,
      values,
    );
    return result.rows[0] ? mapCustomDomain(result.rows[0]) : null;
  }

  async getAdminPasswordHash() {
    const result = await this.query<{ password_hash: string }>("select password_hash from public.admin_credentials where id = 1 limit 1");
    return result.rows[0]?.password_hash ?? null;
  }

  async setAdminPasswordHash(hash: string) {
    await this.query(
      `
        insert into public.admin_credentials (id, password_hash)
        values (1, $1)
        on conflict (id) do update set password_hash = excluded.password_hash, updated_at = now()
      `,
      [hash],
    );
  }

  async createAdminSession(tokenHash: string, expiresAt: Date) {
    await this.query(
      `insert into public.admin_sessions (token_hash, expires_at) values ($1, $2) on conflict (token_hash) do update set expires_at = excluded.expires_at`,
      [tokenHash, expiresAt],
    );
  }

  async getAdminSession(tokenHash: string) {
    const result = await this.query<{ token_hash: string; expires_at: string | Date }>(
      "select token_hash, expires_at from public.admin_sessions where token_hash = $1 limit 1",
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? { tokenHash: row.token_hash, expiresAt: timestamp(row.expires_at) ?? new Date(0).toISOString() } : null;
  }

  async deleteAdminSession(tokenHash: string) {
    await this.query("delete from public.admin_sessions where token_hash = $1", [tokenHash]);
  }

  async deleteExpiredAdminSessions(before: Date) {
    await this.query("delete from public.admin_sessions where expires_at <= $1", [before]);
  }

  async createOAuthState(stateHash: string, sessionTokenHash: string, sourceId: string, expiresAt: Date) {
    await this.query(
      `
        insert into public.oauth_states (state_hash, session_token_hash, source_id, expires_at)
        values ($1, $2, $3, $4)
        on conflict (state_hash) do update set session_token_hash = excluded.session_token_hash,
          source_id = excluded.source_id, expires_at = excluded.expires_at
      `,
      [stateHash, sessionTokenHash, sourceId, expiresAt],
    );
  }

  async consumeOAuthState(stateHash: string) {
    const result = await this.query<{ session_token_hash: string; source_id: string; expires_at: string | Date }>(
      `delete from public.oauth_states where state_hash = $1 returning session_token_hash, source_id, expires_at`,
      [stateHash],
    );
    const row = result.rows[0];
    if (!row || new Date(timestamp(row.expires_at) ?? 0) <= new Date()) {
      return null;
    }
    return {
      sessionTokenHash: row.session_token_hash,
      sourceId: row.source_id,
      expiresAt: timestamp(row.expires_at) ?? new Date(0).toISOString(),
    };
  }

  async close() {
    await this.pool.end();
  }
}

export function createStore(config: AppConfig): MailboxStore {
  if (!hasDatabaseConfig(config)) {
    throw new Error("DATABASE_URL is required");
  }

  console.info("[INFO] Using PostgreSQL via Supabase session pooler");
  return new PostgresStore(config.databaseUrl!);
}
