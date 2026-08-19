export type AliasType = "dot" | "plus";

export type Mailbox = {
  id: string;
  address: string;
  type: AliasType;
  createdAt: string;
};

export type Message = {
  id: string;
  gmailMessageId: string;
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  snippet: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  receivedAt: string | null;
  createdAt: string;
};

export type NewMessage = {
  mailboxId: string;
  gmailMessageId: string;
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  snippet: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  receivedAt: string | null;
};

export type Database = {
  public: {
    Tables: {
      mailboxes: {
        Row: {
          id: string;
          address: string;
          trick_type: AliasType;
          created_at: string;
        };
        Insert: {
          id?: string;
          address: string;
          trick_type: AliasType;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["mailboxes"]["Insert"]>;
        Relationships: [];
      };
      messages: {
        Row: {
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
        Insert: {
          id?: string;
          mailbox_id: string;
          gmail_message_id: string;
          sender?: string | null;
          recipient?: string | null;
          subject?: string | null;
          snippet?: string | null;
          body_html?: string | null;
          body_text?: string | null;
          received_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
        Relationships: [];
      };
      app_state: {
        Row: {
          key: string;
          value: string | null;
        };
        Insert: {
          key: string;
          value?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["app_state"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      trim_mailbox_messages: {
        Args: { target_mailbox: string; keep_limit?: number };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export interface MailboxStore {
  readonly kind: "memory" | "supabase";
  createMailbox(address: string, type: AliasType): Promise<Mailbox>;
  findMailboxByAddress(address: string): Promise<Mailbox | null>;
  listMessages(address: string, limit: number): Promise<Message[]>;
  getMessage(id: string): Promise<Message | null>;
  insertMessage(message: NewMessage): Promise<Message>;
  deleteMessage(id: string): Promise<boolean>;
  deleteMailbox(address: string): Promise<boolean>;
  trimMailboxMessages(mailboxId: string, limit: number): Promise<void>;
  deleteExpiredMessages(before: Date): Promise<number>;
  getState(key: string): Promise<string | null>;
  setState(key: string, value: string): Promise<void>;
}
