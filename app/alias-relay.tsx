"use client";

import { useEffect, useState } from "react";
import { createMailbox as createMailboxApi, deleteMailboxMessage, fetchMailboxMessages, type ApiMessage } from "./api";
import { Icon } from "./icons";

const SOURCE_LOCAL = "ahmadrizal";
const SOURCE_ADDRESS = `${SOURCE_LOCAL}@gmail.com`;
const STORAGE_KEY = "alias-relay-prototype-v1";
const MAX_MESSAGES = 20;
const DEFAULT_ADDRESS = `${SOURCE_LOCAL}+inbox7@gmail.com`;
const DISPLAY_TIME_ZONE = "Asia/Jakarta";

type AliasType = "dot" | "plus";
type MessageTone = "blue" | "coral" | "yellow";
type Route =
  | { kind: "home" }
  | { kind: "history" }
  | { kind: "mailbox"; address: string };

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
};

const MODE_COPY: Record<AliasType, string> = {
  dot: "Place dots between letters in the local part. Gmail routes every variation to the same source inbox.",
  plus: "Add a unique tag before @gmail.com. The larger alias space makes this the default.",
};

const SAMPLE_MESSAGES: Omit<Message, "id" | "recipient" | "receivedAt">[] = [
  {
    senderName: "Notion",
    sender: "team@notion.so",
    subject: "You are invited to a workspace",
    snippet: "Your test workspace is waiting for you.",
    body: "You have been invited to join a Notion workspace.\n\nOpen the invite link to get started. This sample message was added by the frontend prototype.",
    tone: "blue",
  },
  {
    senderName: "Stripe",
    sender: "receipts@stripe.com",
    subject: "Your test payment receipt",
    snippet: "Here is the receipt for your latest test payment.",
    body: "Thanks for testing with Stripe.\n\nThis is a sample receipt email so you can exercise the detail view without a backend connection.",
    tone: "yellow",
  },
  {
    senderName: "Example App",
    sender: "hello@example.test",
    subject: "Welcome to Example App",
    snippet: "Your account has been created successfully.",
    body: "Welcome.\n\nYour account is ready. This test message demonstrates how a new incoming email will be shown in the public mailbox.",
    tone: "coral",
  },
];

function createInitialState(): AppState {
  return {
    history: [
      {
        address: DEFAULT_ADDRESS,
        type: "plus",
        createdAt: "2026-08-19T10:29:00+07:00",
      },
      {
        address: "ah.mad.rizal@gmail.com",
        type: "dot",
        createdAt: "2026-08-17T09:12:00+07:00",
      },
      {
        address: "a.hmad.rizal@gmail.com",
        type: "dot",
        createdAt: "2026-08-14T16:40:00+07:00",
      },
    ],
    mailboxes: {
      [DEFAULT_ADDRESS]: {
        type: "plus",
        messages: [
          {
            id: "seed-github",
            senderName: "GitHub",
            sender: "noreply@github.com",
            recipient: DEFAULT_ADDRESS,
            subject: "Verify your email address",
            snippet: "A quick click and your account is ready to go.",
            body: "Hi there,\n\nThanks for signing up for GitHub. Confirm your email address to finish setting up your account.\n\nThis is a prototype message, but the mailbox flow is ready for a real API connection.\n\nThe Alias Relay team",
            receivedAt: "2026-08-19T10:31:00+07:00",
            tone: "blue",
          },
          {
            id: "seed-discord",
            senderName: "Discord",
            sender: "noreply@discord.com",
            recipient: DEFAULT_ADDRESS,
            subject: "Your verification code is 482 901",
            snippet: "Use this code to verify your new Discord account.",
            body: "Your Discord verification code is:\n\n482 901\n\nThis code expires in 10 minutes. If you did not request this email, you can safely ignore it.",
            receivedAt: "2026-08-19T10:26:00+07:00",
            tone: "coral",
          },
          {
            id: "seed-linear",
            senderName: "Linear",
            sender: "hello@linear.app",
            recipient: DEFAULT_ADDRESS,
            subject: "Welcome to your new workspace",
            snippet: "Your issue tracker is ready when you are.",
            body: "Welcome to Linear.\n\nYour workspace has been created and is ready for your first issue. Invite a teammate or jump straight into your next test flow.",
            receivedAt: "2026-08-19T10:15:00+07:00",
            tone: "yellow",
          },
        ],
      },
      "ah.mad.rizal@gmail.com": { type: "dot", messages: [] },
      "a.hmad.rizal@gmail.com": { type: "dot", messages: [] },
    },
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

function randomTag(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  for (let index = 0; index < length; index += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

function generateAlias(type: AliasType, knownAddresses: Set<string>) {
  if (type === "plus") {
    let candidate = "";
    do {
      candidate = `${SOURCE_LOCAL}+${randomTag()}@gmail.com`;
    } while (knownAddresses.has(candidate));
    return candidate;
  }

  let candidate = "";
  let attempts = 0;
  do {
    const forcedDotPosition = 1 + Math.floor(Math.random() * (SOURCE_LOCAL.length - 1));
    let local = SOURCE_LOCAL[0];

    for (let index = 1; index < SOURCE_LOCAL.length; index += 1) {
      if (index === forcedDotPosition || Math.random() > 0.52) {
        local += ".";
      }
      local += SOURCE_LOCAL[index];
    }

    candidate = `${local}@gmail.com`;
    attempts += 1;
  } while (knownAddresses.has(candidate) && attempts < 100);

  return candidate;
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
    receivedAt: message.received_at ?? message.created_at,
    tone: messageTone(sender),
  };
}

export default function AliasRelay() {
  const [state, setState] = useState<AppState>(() => createInitialState());
  const [route, setRoute] = useState<Route>({ kind: "home" });
  const [selectedType, setSelectedType] = useState<AliasType>("plus");
  const [currentAlias, setCurrentAlias] = useState(DEFAULT_ADDRESS);
  const [currentAliasType, setCurrentAliasType] = useState<AliasType>("plus");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);

  useEffect(() => {
    const stored = loadStoredState();
    setState(stored);
    setCurrentAlias(stored.history[0]?.address ?? DEFAULT_ADDRESS);
    setSelectedType(stored.history[0]?.type ?? "plus");
    setCurrentAliasType(stored.history[0]?.type ?? "plus");
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
        // Keep the local prototype mailbox when the API is not running yet.
      }
    };

    void sync();
    const interval = window.setInterval(() => void sync(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [route]);

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
      ].slice(0, 20),
      mailboxes: state.mailboxes[address]
        ? state.mailboxes
        : { ...state.mailboxes, [address]: { type, messages: [] } },
    };

    setState(nextState);
  }

  function openMailbox(address: string, type?: AliasType) {
    const knownType = state.history.find((entry) => entry.address === address)?.type ?? type ?? "plus";
    rememberAlias(address, knownType);
    setSelectedMessageId(null);
    setRoute({ kind: "mailbox", address });
    window.location.hash = encodeURIComponent(address);
  }

  function goHome() {
    setRoute({ kind: "home" });
    if (window.location.hash) {
      window.location.hash = "";
    }
  }

  async function generateNewAlias() {
    setIsGenerating(true);
    try {
      const mailbox = await createMailboxApi(selectedType);
      rememberAlias(mailbox.address, mailbox.type);
      setCurrentAlias(mailbox.address);
      setCurrentAliasType(mailbox.type);
      showToast("New alias generated");
    } catch {
      const knownAddresses = new Set(state.history.map((entry) => entry.address));
      const address = generateAlias(selectedType, knownAddresses);
      rememberAlias(address, selectedType);
      setCurrentAlias(address);
      setCurrentAliasType(selectedType);
      showToast("Backend unavailable; local alias generated");
    } finally {
      setIsGenerating(false);
    }
  }

  function clearHistory() {
    if (!state.history.length) {
      return;
    }
    setState({ ...state, history: [] });
    showToast("Browser history cleared");
  }

  function simulateIncomingMessage() {
    if (route.kind !== "mailbox") {
      return;
    }

    const currentMailbox = mailbox ?? { type: "plus" as AliasType, messages: [] };
    const sample = SAMPLE_MESSAGES[currentMailbox.messages.length % SAMPLE_MESSAGES.length];
    const newMessage: Message = {
      ...sample,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      recipient: route.address,
      receivedAt: new Date().toISOString(),
    };
    const nextMailbox: Mailbox = {
      ...currentMailbox,
      messages: [newMessage, ...currentMailbox.messages].slice(0, MAX_MESSAGES),
    };
    const nextState: AppState = {
      ...state,
      mailboxes: { ...state.mailboxes, [route.address]: nextMailbox },
    };

    setState(nextState);
    setSelectedMessageId(newMessage.id);
    showToast("Test email added to the inbox");
  }

  async function deleteMessage(messageId: string) {
    if (route.kind !== "mailbox" || !mailbox) {
      return;
    }

    try {
      await deleteMailboxMessage(messageId);
    } catch {
      // Keep the local delete behavior when this message only exists in prototype state.
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
          <h2>One Gmail. A fresh address for every test.</h2>
        </div>

        <div className="source-status">
          <span className="status-dot" aria-hidden="true" />
          <span>Gmail source connected</span>
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
            <span className="live-label">
              <span className="status-dot" aria-hidden="true" /> Prototype mode
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
                <p>Spin up a disposable Gmail address without creating another account. Send your test email, then watch it land here.</p>
                <div className="hero-details" aria-label="Product features">
                  <span>No login</span>
                  <span>Open in seconds</span>
                  <span>20 messages max</span>
                </div>
              </div>

              <section className="generator-panel" aria-labelledby="generator-title">
                <div className="panel-heading">
                  <span className="panel-label" id="generator-title">01 / Create an alias</span>
                  <span className="source-label">routes to {SOURCE_ADDRESS}</span>
                </div>

                <div className="generator-form">
                  <span className="field-label">Choose your pattern</span>
                  <div className="mode-toggle" role="group" aria-label="Alias pattern">
                    {(["dot", "plus"] as AliasType[]).map((type) => (
                      <button
                        className={`mode-button ${selectedType === type ? "is-active" : ""}`}
                        type="button"
                        aria-pressed={selectedType === type}
                        key={type}
                        onClick={() => setSelectedType(type)}
                      >
                        <span className="mode-symbol">{type === "dot" ? "." : "+"}</span>
                        <span>{type === "dot" ? "Dot trick" : "Plus trick"}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mode-explainer">{MODE_COPY[selectedType]}</p>

                  <div className="address-preview">
                    <span className="preview-label">Your temporary address</span>
                    <div className="address-line">
                      <code className="address-value">{currentAlias}</code>
                      <button
                        className="icon-button"
                        type="button"
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
                      <span>ready to receive</span>
                      <button className="preview-open" type="button" onClick={() => openMailbox(currentAlias, currentAliasType)}>
                        <span>Open mailbox</span>
                        <Icon name="arrow" />
                      </button>
                    </div>
                  </div>

                  <button className="primary-button" type="button" disabled={isGenerating} onClick={generateNewAlias}>
                    <span>{isGenerating ? "Making your alias..." : "Generate new alias"}</span>
                    <span className="button-arrow" aria-hidden="true">&gt;</span>
                  </button>
                  <p className="panel-footnote">No Gmail account is created. Alias addresses share one source inbox.</p>
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
                      <button className="history-item" type="button" key={entry.address} onClick={() => openMailbox(entry.address, entry.type)}>
                        <span className={`history-type ${entry.type === "dot" ? "dot" : ""}`}>{entry.type === "dot" ? "." : "+"}</span>
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
                  <span>{mailbox?.type === "dot" ? "Dot" : "Plus"} trick</span>
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
                <button className="secondary-button is-accent" type="button" onClick={simulateIncomingMessage}>
                  <Icon name="plus" />
                  <span>Simulate email</span>
                </button>
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
                    <button className="secondary-button" type="button" onClick={simulateIncomingMessage}>Add a test email</button>
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
                    <div className="detail-body">{selectedMessage.body || selectedMessage.snippet || "No message body available."}</div>
                    <div className="detail-footer">
                      <span className="detail-retention">Stored locally for prototype.<br />Production retention: 7 days.</span>
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
