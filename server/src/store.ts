import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeAddress } from "./alias";
import { ConflictError } from "./errors";
import { hasSupabaseConfig, type AppConfig } from "./config";
import type { AliasType, Database, Mailbox, MailboxStore, Message, NewMessage } from "./types";

type MailboxRow = Database["public"]["Tables"]["mailboxes"]["Row"];
type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

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

export class InMemoryStore implements MailboxStore {
  readonly kind = "memory" as const;
  private readonly mailboxes = new Map<string, Mailbox>();
  private readonly messages = new Map<string, Message & { mailboxId: string }>();
  private readonly appState = new Map<string, string>();

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
}

export class SupabaseStore implements MailboxStore {
  readonly kind = "supabase" as const;
  private readonly client: SupabaseClient<Database>;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient<Database>(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  async createMailbox(address: string, type: AliasType) {
    const { data, error } = await this.client
      .from("mailboxes")
      .insert({ address: normalizeAddress(address), trick_type: type })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ConflictError("Mailbox address is already registered");
      }
      throw error;
    }
    return mapMailbox(data);
  }

  async findMailboxByAddress(address: string) {
    const { data, error } = await this.client.from("mailboxes").select("*").eq("address", normalizeAddress(address)).maybeSingle();
    if (error) {
      throw error;
    }
    return data ? mapMailbox(data) : null;
  }

  async listMessages(address: string, limit: number) {
    const mailbox = await this.findMailboxByAddress(address);
    if (!mailbox) {
      return [];
    }

    const { data, error } = await this.client
      .from("messages")
      .select("*")
      .eq("mailbox_id", mailbox.id)
      .order("received_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      throw error;
    }
    return (data ?? []).map(mapMessage);
  }

  async getMessage(id: string) {
    const { data, error } = await this.client.from("messages").select("*").eq("id", id).maybeSingle();
    if (error) {
      throw error;
    }
    return data ? mapMessage(data) : null;
  }

  async insertMessage(input: NewMessage) {
    const { data, error } = await this.client
      .from("messages")
      .insert({
        mailbox_id: input.mailboxId,
        gmail_message_id: input.gmailMessageId,
        sender: input.sender,
        recipient: input.recipient,
        subject: input.subject,
        snippet: input.snippet,
        body_html: input.bodyHtml,
        body_text: input.bodyText,
        received_at: input.receivedAt,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        const existing = await this.client.from("messages").select("*").eq("gmail_message_id", input.gmailMessageId).single();
        if (existing.error) {
          throw existing.error;
        }
        return mapMessage(existing.data);
      }
      throw error;
    }
    return mapMessage(data);
  }

  async deleteMessage(id: string) {
    const { data, error } = await this.client.from("messages").delete().eq("id", id).select("id");
    if (error) {
      throw error;
    }
    return Boolean(data?.length);
  }

  async deleteMailbox(address: string) {
    const { data, error } = await this.client.from("mailboxes").delete().eq("address", normalizeAddress(address)).select("id");
    if (error) {
      throw error;
    }
    return Boolean(data?.length);
  }

  async trimMailboxMessages(mailboxId: string, limit: number) {
    const { error } = await this.client.rpc("trim_mailbox_messages", { target_mailbox: mailboxId, keep_limit: limit });
    if (error) {
      throw error;
    }
  }

  async deleteExpiredMessages(before: Date) {
    const { data, error } = await this.client.from("messages").delete().lt("received_at", before.toISOString()).select("id");
    if (error) {
      throw error;
    }
    return data?.length ?? 0;
  }

  async getState(key: string) {
    const { data, error } = await this.client.from("app_state").select("value").eq("key", key).maybeSingle();
    if (error) {
      throw error;
    }
    return data?.value ?? null;
  }

  async setState(key: string, value: string) {
    const { error } = await this.client.from("app_state").upsert({ key, value });
    if (error) {
      throw error;
    }
  }
}

export function createStore(config: AppConfig): MailboxStore {
  if (hasSupabaseConfig(config)) {
    console.info("[INFO] Using Supabase storage");
    return new SupabaseStore(config.supabaseUrl!, config.supabaseServiceRoleKey!);
  }

  console.warn("[WARN] Supabase credentials are missing; using in-memory storage");
  return new InMemoryStore();
}
