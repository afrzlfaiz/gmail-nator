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

export interface MailboxStore {
  readonly kind: "memory" | "postgres";
  ping(): Promise<void>;
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
  close(): Promise<void>;
}
