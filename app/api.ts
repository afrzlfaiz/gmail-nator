import type { AliasType } from "./alias-relay-types";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export type ApiMailbox = {
  address: string;
  type: AliasType;
  url: string;
};

export type ApiMessage = {
  id: string;
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

type ApiMessagesResponse = {
  mailbox: string;
  messages: ApiMessage[];
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `API request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      // Keep the status-based error when the response is not JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function createMailbox(type: AliasType) {
  return apiRequest<ApiMailbox>("/api/mailboxes", {
    method: "POST",
    body: JSON.stringify({ type }),
  });
}

export function fetchMailboxMessages(address: string) {
  return apiRequest<ApiMessagesResponse>(`/api/mailboxes/${encodeURIComponent(address)}/messages`);
}

export function deleteMailboxMessage(id: string) {
  return apiRequest<void>(`/api/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
}
