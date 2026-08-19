"use client";

import { useEffect, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { ApiError, createMailbox as createMailboxApi, deleteMailboxMessage, fetchApiHealth, fetchMailboxMessages, type ApiMessage } from "./api";
import { generateAlias } from "./alias-generator";
import { Icon } from "./icons";
import type { AliasType } from "./alias-relay-types";

const STORAGE_KEY = "alias-relay-state-v2";
const MAX_MESSAGES = 20;
const MAX_DISPLAYED_ALIASES = 20;
const DISPLAY_TIME_ZONE = "Asia/Jakarta";

type MessageTone = "blue" | "coral" | "yellow";
type Route =
  | { kind: "home" }
  | { kind: "history" }
  | { kind: "mailbox"; address: string };
type ApiStatus = "checking" | "connected" | "offline";

type HistoryEntry = {
  address: string;
  type: AliasType;
  createdAt: string;
};

type Message = {
  id: string;
  senderName: string;
  sender: string;
  recipient: string;
  subject: string;
  snippet: string;
  body: string;
  bodyHtml: string | null;
  receivedAt: string;
  tone: MessageTone;
};

type Mailbox = {
  type: AliasType;
  messages: Message[];
};

type AppState = {
  history: HistoryEntry[];
  mailboxes: Record<string, Mailbox>;
};

const TYPE_LABELS: Record<AliasType, string> = {
  dot: "DOT TRICK",
  plus: "PLUS TRICK",
  mixed: "MIXED TRICK",
  custom: "CUSTOM DOMAIN",
};

const MODE_COPY: Record<AliasType, string> = {
  dot: "Place dots between letters in the local part. Gmail routes every variation to the same source inbox.",
  plus: "Add a unique tag before @gmail.com. The larger alias space makes this the default.",
  mixed: "Combine dots and a plus tag in one address for a larger set of Gmail variations.",
  custom: "Use a random address on a configured custom domain forwarded to a Gmail source.",
};

function aliasTypeForAddress(address: string): AliasType {
  const normalized = address.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  const localPart = atIndex >= 0 ? normalized.slice(0, atIndex) : normalized;
  const domain = atIndex >= 0 ? normalized.slice(atIndex + 1) : "";
  if (domain !== "gmail.com") {
    return "custom";
  }
  if (localPart.includes("+") && localPart.split("+")[0]?.includes(".")) {
    return "mixed";
  }
  return localPart.includes("+") ? "plus" : "dot";
}

function createInitialState(): AppState {
  return {
    history: [],
    mailboxes: {},
  };
}

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AppState>;
  return Array.isArray(candidate.history) && typeof candidate.mailboxes === "object" && candidate.mailboxes !== null;
}

function loadStoredState(): AppState {
  const fallback = createInitialState();

  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    return isAppState(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function persistState(state: AppState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The current session remains usable when browser storage is unavailable.
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: DISPLAY_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part.slice(0, 1))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
}

function messageTone(sender: string) {
  const tones: MessageTone[] = ["blue", "coral", "yellow"];
  const hash = [...sender].reduce((total, character) => total + character.charCodeAt(0), 0);
  return tones[hash % tones.length];
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function apiMessageToMessage(message: ApiMessage): Message {
  const sender = message.sender ?? "Unknown sender";
  const subject = message.subject ?? "(No subject)";
  const body = message.body_text || (message.body_html ? stripHtml(message.body_html) : "No message body available.");

  return {
    id: message.id,
    senderName: sender.includes("<") ? sender.split("<")[0].trim() || sender : sender.split("@")[0],
    sender,
    recipient: message.recipient ?? "",
    subject,
    snippet: message.snippet ?? body.slice(0, 140),
    body,
    bodyHtml: message.body_html,
    receivedAt: message.received_at ?? message.created_at,
    tone: messageTone(sender),
  };
}

export default function AliasRelay() {
  const [state, setState] = useState<AppState>(() => createInitialState());
  const [route, setRoute] = useState<Route>({ kind: "home" });
  const [selectedType, setSelectedType] = useState<AliasType>("plus");
  const [currentAlias, setCurrentAlias] = useState("");
  const [currentAliasType, setCurrentAliasType] = useState<AliasType>("plus");
  const [currentAliasRegistered, setCurrentAliasRegistered] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [mailboxSyncNonce, setMailboxSyncNonce] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [gmailRelayReady, setGmailRelayReady] = useState(false);
  const [sourceLocalParts, setSourceLocalParts] = useState<string[]>([]);
  const [customDomains, setCustomDomains] = useState<string[]>([]);

  useEffect(() => {
    const stored = loadStoredState();
    setState(stored);
    const firstAlias = stored.history[0];
    if (firstAlias) {
      setCurrentAlias(firstAlias.address);
      setSelectedType(firstAlias.type);
      setCurrentAliasType(firstAlias.type);
      setCurrentAliasRegistered(true);
    }
    setHasLoadedStorage(true);

    const updateRoute = () => {
      const rawHash = window.location.hash.slice(1);

      if (!rawHash) {
        setRoute({ kind: "home" });
        return;
      }

      if (rawHash === "history") {
        setRoute({ kind: "history" });
        return;
      }

      let address = rawHash.startsWith("mailbox/") ? rawHash.slice("mailbox/".length) : rawHash;
      try {
        address = decodeURIComponent(address);
      } catch {
        // Keep the raw fragment when it is not valid URI encoding.
      }

      setRoute(address.includes("@") ? { kind: "mailbox", address } : { kind: "home" });
    };

    updateRoute();
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkApi = async () => {
      try {
        const health = await fetchApiHealth();
        if (!cancelled) {
          setApiStatus("connected");
          setGmailRelayReady(health.gmailRelayReady);
          setSourceLocalParts(health.gmailSourceLocalParts);
          setCustomDomains(health.customDomains);
        }
      } catch {
        if (!cancelled) {
          setApiStatus("offline");
          setGmailRelayReady(false);
          setSourceLocalParts([]);
          setCustomDomains([]);
        }
      }
    };

    void checkApi();
    const interval = window.setInterval(() => void checkApi(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (hasLoadedStorage) {
      persistState(state);
    }
  }, [hasLoadedStorage, state]);

  useEffect(() => {
    if (route.kind === "history") {
      window.setTimeout(() => document.getElementById("history-section")?.scrollIntoView({ behavior: "smooth" }), 0);
    }
  }, [route]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 2700);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (route.kind !== "mailbox" || state.history.some((entry) => entry.address === route.address)) {
      return;
    }

    let cancelled = false;
    const type = aliasTypeForAddress(route.address);
    const ensureMailbox = async () => {
      try {
        const mailbox = await createMailboxApi(type, route.address);
        if (cancelled) {
          return;
        }
        rememberAlias(mailbox.address, mailbox.type);
        setMailboxSyncNonce((nonce) => nonce + 1);
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 409) {
          rememberAlias(route.address, type);
          setMailboxSyncNonce((nonce) => nonce + 1);
        } else if (error instanceof ApiError && error.status === 503) {
          showToast("Gmail relay is not ready yet");
        } else if (error instanceof ApiError && error.status === 400) {
          showToast("This address is not a valid source alias");
        } else {
          showToast("Could not register this mailbox");
        }
      }
    };

    void ensureMailbox();
    return () => {
      cancelled = true;
    };
  }, [route.kind === "mailbox" ? route.address : null]);

  useEffect(() => {
    if (route.kind !== "mailbox") {
      setLastSyncedAt(null);
      return;
    }

    let cancelled = false;
    const sync = async () => {
      setLastSyncedAt(new Date().toISOString());
      try {
        const result = await fetchMailboxMessages(route.address);
        if (cancelled) {
          return;
        }

        const apiMessages = result.messages.map(apiMessageToMessage);
        setState((currentState) => {
          const currentMailbox = currentState.mailboxes[route.address] ?? { type: "plus" as AliasType, messages: [] };
          return {
            ...currentState,
            mailboxes: {
              ...currentState.mailboxes,
              [route.address]: { ...currentMailbox, messages: apiMessages },
            },
          };
        });
      } catch {
        // Keep the last successful server snapshot during a temporary API failure.
      }
    };

    void sync();
    const interval = window.setInterval(() => void sync(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [route, mailboxSyncNonce]);

  const mailbox =
    route.kind === "mailbox"
      ? state.mailboxes[route.address] ?? {
          type: state.history.find((entry) => entry.address === route.address)?.type ?? "plus",
          messages: [],
        }
      : null;
  const messages = mailbox?.messages.slice(0, MAX_MESSAGES) ?? [];
  const selectedMessage = messages.find((message) => message.id === selectedMessageId) ?? messages[0] ?? null;

  function showToast(message: string) {
    setToast(message);
  }

  function rememberAlias(address: string, type: AliasType) {
    const nextState: AppState = {
      history: [
        { address, type, createdAt: new Date().toISOString() },
        ...state.history.filter((entry) => entry.address !== address),
      ].slice(0, MAX_DISPLAYED_ALIASES),
      mailboxes: state.mailboxes[address]
        ? state.mailboxes
        : { ...state.mailboxes, [address]: { type, messages: [] } },
    };

    setState(nextState);
  }

  function openMailbox(address: string, type?: AliasType, alreadyRegistered = false) {
    const knownType = state.history.find((entry) => entry.address === address)?.type ?? type ?? "plus";
    if (alreadyRegistered) {
      rememberAlias(address, knownType);
      setSelectedMessageId(null);
      setRoute({ kind: "mailbox", address });
      window.location.hash = address;
      return;
    }
    void registerMailbox(address, knownType);
  }

  async function registerMailbox(address: string, type: AliasType) {
    setIsSaving(true);
    try {
      const mailbox = await createMailboxApi(type, address);
      rememberAlias(mailbox.address, mailbox.type);
      setCurrentAlias(mailbox.address);
      setCurrentAliasType(mailbox.type);
      setCurrentAliasRegistered(true);
      setSelectedMessageId(null);
      setRoute({ kind: "mailbox", address: mailbox.address });
      window.location.hash = mailbox.address;
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        showToast("Gmail relay is not ready yet");
      } else if (error instanceof ApiError && error.status === 409) {
        showToast("This address is already registered");
      } else {
        showToast("Could not register the mailbox");
      }
    } finally {
      setIsSaving(false);
    }
  }

  function goHome() {
    setRoute({ kind: "home" });
    if (window.location.hash) {
      window.location.hash = "";
    }
  }

  function generateNewAlias() {
    try {
      const address = generateAlias(selectedType, sourceLocalParts, customDomains);
      setCurrentAlias(address);
      setCurrentAliasType(selectedType);
      setCurrentAliasRegistered(false);
      showToast("Alias generated locally");
    } catch {
      showToast(selectedType === "custom" ? "No custom domain is ready yet" : "No Gmail source is ready yet");
    }
  }

  function clearHistory() {
    if (!state.history.length) {
      return;
    }
    setState({ ...state, history: [] });
    showToast("Browser history cleared");
  }

  async function deleteMessage(messageId: string) {
    if (route.kind !== "mailbox" || !mailbox) {
      return;
    }

    try {
      await deleteMailboxMessage(messageId);
    } catch {
      showToast("Could not delete message");
      return;
    }

    const nextMessages = mailbox.messages.filter((message) => message.id !== messageId);
    const nextState: AppState = {
      ...state,
      mailboxes: {
        ...state.mailboxes,
        [route.address]: { ...mailbox, messages: nextMessages },
      },
    };

    setState(nextState);
    setSelectedMessageId(nextMessages[0]?.id ?? null);
    showToast("Message deleted");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <a
          className="brand"
          href="#"
          aria-label="Alias Relay home"
          onClick={(event) => {
            event.preventDefault();
            goHome();
          }}
        >
          <span className="brand-mark">a.</span>
          <span>alias relay</span>
        </a>

        <div className="sidebar-intro">
          <span className="sidebar-kicker">Temporary mail / 01</span>
          <h2>Multiple sources. A fresh address for every test.</h2>
        </div>

        <div className="source-status">
          <span className={`status-dot ${gmailRelayReady ? "is-ready" : apiStatus === "offline" ? "is-offline" : "is-checking"}`} aria-hidden="true" />
          <span>{gmailRelayReady ? `Gmail relay ready / ${sourceLocalParts.length} source${sourceLocalParts.length === 1 ? "" : "s"}` : apiStatus === "offline" ? "Gmail relay unavailable" : "Checking Gmail relay"}</span>
        </div>

        <nav className="sidebar-nav">
          <a
            className={`nav-link ${route.kind === "home" ? "is-active" : ""}`}
            href="#"
            onClick={(event) => {
              event.preventDefault();
              goHome();
            }}
          >
            <span className="nav-link-main">
              <Icon name="home" />
              <span>Generator</span>
            </span>
            <span className="nav-count">01</span>
          </a>
          <a
            className={`nav-link ${route.kind === "history" ? "is-active" : ""}`}
            href="#history"
            onClick={() => setRoute({ kind: "history" })}
          >
            <span className="nav-link-main">
              <Icon name="history" />
              <span>Previously made</span>
            </span>
            <span className="nav-count">{String(state.history.length).padStart(2, "0")}</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="side-rule" />
          <div className="side-metrics">
            <div className="side-metric">
              <span>Messages</span>
              <strong>20 max</strong>
            </div>
            <div className="side-metric">
              <span>Retention</span>
              <strong>7 days</strong>
            </div>
          </div>
          <p className="sidebar-note">Built for QA, signup flows, and the emails you do not want in your main inbox.</p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-context">
            <strong>Workspace</strong> / Public inbox utility
          </div>
          <div className="topbar-right">
            <span className={`live-label is-${apiStatus}`}>
              <span className="status-dot" aria-hidden="true" />
              {apiStatus === "offline" ? "API unavailable" : apiStatus === "connected" && gmailRelayReady ? "Gmail relay ready" : apiStatus === "connected" ? "Waiting for Gmail relay" : "Connecting API"}
            </span>
          </div>
        </header>

        {route.kind !== "mailbox" ? (
          <section className="view home-view" aria-labelledby="home-title">
            <div className="hero-grid">
              <div className="hero-copy">
                <span className="eyebrow">Temporary mail / Gmail alias</span>
                <h1 id="home-title">
                  A clean inbox for your next <em>test.</em>
                </h1>
                <p>Spin up a disposable Gmail address without creating another account. Send an email to it, then watch it land here.</p>
                <div className="hero-details" aria-label="Product features">
                  <span>No login</span>
                  <span>Open in seconds</span>
                  <span>20 messages max</span>
                </div>
              </div>

              <section className="generator-panel" aria-labelledby="generator-title">
                <div className="panel-heading">
                  <span className="panel-label" id="generator-title">01 / Create an alias</span>
                  <span className="source-label">{gmailRelayReady ? `${sourceLocalParts.length} Gmail source${sourceLocalParts.length === 1 ? "" : "s"} active` : "Server relay required"}</span>
                </div>

                <div className="generator-form">
                  <span className="field-label">Choose your pattern</span>
                  <div className="mode-toggle" role="group" aria-label="Alias pattern">
                    {(["dot", "plus", "mixed", "custom"] as AliasType[]).map((type) => (
                      <button
                        className={`mode-button ${selectedType === type ? "is-active" : ""}`}
                        type="button"
                        aria-pressed={selectedType === type}
                        key={type}
                        onClick={() => setSelectedType(type)}
                      >
                        <span className="mode-symbol">{type === "dot" ? "." : type === "plus" ? "+" : type === "mixed" ? ".+" : "@"}</span>
                        <span>{type === "dot" ? "Dot trick" : type === "plus" ? "Plus trick" : type === "mixed" ? "Mixed trick" : "Custom domain"}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mode-explainer">{MODE_COPY[selectedType]}</p>

                  <div className="address-preview">
                    <span className="preview-label">Your temporary address</span>
                    <div className="address-line">
                      <code className="address-value">{currentAlias || (gmailRelayReady ? "No mailbox yet" : "Waiting for server source...")}</code>
                      <button
                        className="icon-button"
                        type="button"
                        disabled={!currentAlias}
                        aria-label="Copy generated address"
                        title="Copy address"
                        onClick={() => void copyText(currentAlias).then(() => showToast("Alias address copied"))}
                      >
                        <Icon name="clipboard" />
                      </button>
                    </div>
                    <div className="preview-meta">
                      <span className={`type-badge ${currentAliasType === "dot" ? "dot" : ""}`}>{TYPE_LABELS[currentAliasType]}</span>
                      <span className="meta-separator" aria-hidden="true" />
                      <span>{currentAliasRegistered ? "registered on server" : currentAlias ? "generated in browser" : "waiting for relay"}</span>
                    </div>
                    <button className="mailbox-cta" type="button" disabled={!currentAlias || isSaving} onClick={() => openMailbox(currentAlias, currentAliasType, currentAliasRegistered)}>
                      <span>{isSaving ? "Saving..." : "Go to mailbox"}</span>
                      <Icon name="arrow" />
                    </button>
                  </div>

                    <button className="primary-button" type="button" disabled={!gmailRelayReady || (selectedType === "custom" && customDomains.length === 0) || isSaving} onClick={generateNewAlias}>
                      <span>{isSaving ? "Generating..." : gmailRelayReady ? selectedType === "custom" && customDomains.length === 0 ? "No custom domain configured" : "Generate new alias" : "Waiting for server source..."}</span>
                    <span className="button-arrow" aria-hidden="true">&gt;</span>
                  </button>
                    <p className="panel-footnote">Generation happens in your browser. Click Go to mailbox to register the address.</p>
                </div>
              </section>
            </div>

            <div className="below-fold" id="history-section">
              <section className="history-block" aria-labelledby="history-title">
                <div className="section-heading">
                  <div>
                    <span className="section-kicker">Your browser memory</span>
                    <h2 id="history-title">Previously generated</h2>
                  </div>
                  <button className="text-button" type="button" onClick={clearHistory}>Clear all</button>
                </div>
                <div className="history-list">
                  {state.history.length ? (
                    state.history.map((entry) => (
                      <button className="history-item" type="button" key={entry.address} onClick={() => openMailbox(entry.address, entry.type, true)}>
                        <span className={`history-type ${entry.type === "dot" ? "dot" : ""}`}>{entry.type === "dot" ? "." : entry.type === "mixed" ? ".+" : entry.type === "custom" ? "@" : "+"}</span>
                        <span className="history-address">{entry.address}</span>
                        <span className="history-date">{formatDate(entry.createdAt)}</span>
                        <Icon name="arrow" />
                      </button>
                    ))
                  ) : (
                    <div className="empty-history">No aliases here yet. Generate one above to start your local history.</div>
                  )}
                </div>
              </section>

              <aside className="public-card" aria-label="Public mailbox notice">
                <span className="section-kicker">Read before you send</span>
                <h3>This inbox is public by design.</h3>
                <p>Anyone with the generated address can open its mailbox and read its messages. <strong>Do not use it for personal data.</strong></p>
                <div className="public-card-footer">
                  <span>No password</span>
                  <span>7 day retention</span>
                </div>
              </aside>
            </div>
          </section>
        ) : (
          <section className="view mailbox-view" aria-labelledby="mailbox-address">
            <button className="back-link" type="button" onClick={goHome}>
              <Icon name="back" />
              <span>Back to generator</span>
            </button>

            <div className="mailbox-heading">
              <div className="mailbox-title-wrap">
                <span className="eyebrow">Public mailbox</span>
                <h1 className="mailbox-title" id="mailbox-address">{route.address}</h1>
                <div className="mailbox-meta">
                  <span><span className="status-dot" aria-hidden="true" /> Listening for new mail</span>
                  <span>{mailbox?.type === "dot" ? "Dot" : mailbox?.type === "plus" ? "Plus" : mailbox?.type === "mixed" ? "Mixed" : "Custom domain"} {mailbox?.type === "custom" ? "" : "trick"}</span>
                  <span>Opened from URL fragment</span>
                </div>
              </div>
              <div className="mailbox-title-actions">
                <button className="copy-button" type="button" onClick={() => void copyText(route.address).then(() => showToast("Mailbox address copied"))}>
                  <Icon name="clipboard" />
                  <span>Copy address</span>
                </button>
              </div>
            </div>

            <div className="public-warning" role="note">
              <span className="warning-icon" aria-hidden="true">!</span>
              <span><strong>Public inbox:</strong> anyone who knows this address can read its messages. Avoid OTPs or sensitive information.</span>
            </div>

            <div className="mailbox-toolbar">
              <div className="inbox-heading">
                <h2>Inbox</h2>
                <span className="message-count">{messages.length} / {MAX_MESSAGES} messages</span>
              </div>
              <div className="mailbox-actions">
                <span className="polling-label">
                  <span className="status-dot" aria-hidden="true" /> Refreshes every 5 sec{lastSyncedAt ? ` / ${formatTime(lastSyncedAt)}` : ""}
                </span>
              </div>
            </div>

            <div className="mailbox-layout">
              <div className="message-pane">
                {messages.length ? (
                  <div className="message-list">
                    {messages.map((message) => (
                      <button
                        className={`message-item ${selectedMessage?.id === message.id ? "is-selected" : ""}`}
                        type="button"
                        key={message.id}
                        onClick={() => setSelectedMessageId(message.id)}
                      >
                        <span className={`sender-avatar ${message.tone}`}>{initials(message.senderName || message.sender)}</span>
                        <span className="message-summary">
                          <span className="message-sender">{message.senderName || message.sender}</span>
                          <span className="message-subject">{message.subject}</span>
                          <span className="message-snippet">{message.snippet || message.body}</span>
                        </span>
                        <time className="message-time" dateTime={message.receivedAt}>{formatTime(message.receivedAt)}</time>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-inbox">
                    <span className="empty-inbox-mark">@</span>
                    <h3>Your inbox is listening.</h3>
                    <p>Send an email to this address. New messages will appear here after the next poll.</p>
                  </div>
                )}
              </div>

              <article className="message-detail" aria-live="polite">
                {selectedMessage ? (
                  <div className="detail-content">
                    <div className="detail-topline">
                      <strong>Message received</strong>
                      <time dateTime={selectedMessage.receivedAt}>{formatDate(selectedMessage.receivedAt)} / {formatTime(selectedMessage.receivedAt)}</time>
                    </div>
                    <h3 className="detail-subject">{selectedMessage.subject}</h3>
                    <div className="sender-line">
                      <div className="sender-identity">
                        <span className={`sender-avatar ${selectedMessage.tone}`}>{initials(selectedMessage.senderName || selectedMessage.sender)}</span>
                        <span className="sender-identity-copy">
                          <strong>{selectedMessage.senderName || selectedMessage.sender}</strong>
                          <span>{selectedMessage.sender}</span>
                        </span>
                      </div>
                      <button className="icon-button" type="button" aria-label="Copy sender address" title="Copy sender address" onClick={() => void copyText(selectedMessage.sender).then(() => showToast("Sender address copied"))}>
                        <Icon name="clipboard" />
                      </button>
                    </div>
                    <p className="recipient-line">to <strong>{selectedMessage.recipient || route.address}</strong></p>
                    {selectedMessage.bodyHtml ? (
                      <div
                        className="detail-body html"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedMessage.bodyHtml) }}
                      />
                    ) : (
                      <div className="detail-body">{selectedMessage.body || selectedMessage.snippet || "No message body available."}</div>
                    )}
                    <div className="detail-footer">
                      <span className="detail-retention">Messages are retained for 7 days.<br />The inbox stores up to 20 messages.</span>
                      <button className="delete-button" type="button" onClick={() => deleteMessage(selectedMessage.id)}>Delete message</button>
                    </div>
                  </div>
                ) : (
                  <div className="detail-empty">Select a message to read it here.</div>
                )}
              </article>
            </div>
          </section>
        )}
      </main>

      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast ? <div className="toast">{toast}</div> : null}
      </div>
    </div>
  );
}
