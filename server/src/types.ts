export type AliasType = "dot" | "plus" | "mixed" | "custom";

export type GmailSourceStatus = "pending" | "active" | "disabled" | "reauth_required" | "error";

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
};

export type GmailSource = {
  id: string;
  email: string;
  label: string | null;
  status: GmailSourceStatus;
  refreshToken: EncryptedSecret | null;
  historyId: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GmailSourcePatch = Partial<Pick<GmailSource, "email" | "label" | "status" | "refreshToken" | "historyId" | "lastPolledAt" | "lastError">>;

export type CustomDomain = {
  id: string;
  domain: string;
  sourceId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomDomainPatch = Partial<Pick<CustomDomain, "domain" | "sourceId" | "enabled">>;

export type Mailbox = {
  id: string;
  address: string;
  type: AliasType;
  sourceId: string | null;
  domainId: string | null;
  createdAt: string;
};

export type Message = {
  id: string;
  sourceId: string | null;
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
  sourceId: string;
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
  createMailbox(address: string, type: AliasType, sourceId: string, domainId?: string | null): Promise<Mailbox>;
  findMailboxByAddress(address: string): Promise<Mailbox | null>;
  listMessages(address: string, limit: number): Promise<Message[]>;
  insertMessage(message: NewMessage): Promise<Message>;
  deleteMessage(id: string): Promise<boolean>;
  trimMailboxMessages(mailboxId: string, limit: number): Promise<void>;
  deleteExpiredMessages(before: Date): Promise<number>;
  listGmailSources(): Promise<GmailSource[]>;
  getGmailSource(id: string): Promise<GmailSource | null>;
  createGmailSource(email: string, label?: string | null): Promise<GmailSource>;
  updateGmailSource(id: string, patch: GmailSourcePatch): Promise<GmailSource | null>;
  listCustomDomains(): Promise<CustomDomain[]>;
  getCustomDomain(id: string): Promise<CustomDomain | null>;
  createCustomDomain(domain: string, sourceId: string): Promise<CustomDomain>;
  updateCustomDomain(id: string, patch: CustomDomainPatch): Promise<CustomDomain | null>;
  getAdminPasswordHash(): Promise<string | null>;
  setAdminPasswordHash(hash: string): Promise<void>;
  createAdminSession(tokenHash: string, expiresAt: Date): Promise<void>;
  getAdminSession(tokenHash: string): Promise<{ tokenHash: string; expiresAt: string } | null>;
  deleteAdminSession(tokenHash: string): Promise<void>;
  deleteExpiredAdminSessions(before: Date): Promise<void>;
  createOAuthState(stateHash: string, sessionTokenHash: string, sourceId: string, expiresAt: Date): Promise<void>;
  consumeOAuthState(stateHash: string): Promise<{ sessionTokenHash: string; sourceId: string; expiresAt: string } | null>;
  close(): Promise<void>;
}
