"use client";

import { FormEvent, useEffect, useState } from "react";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

type SourceStatus = "pending" | "active" | "disabled" | "reauth_required" | "error";

type Source = {
  id: string;
  email: string;
  label: string | null;
  status: SourceStatus;
  hasRefreshToken: boolean;
  historyId: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
};

type Domain = {
  id: string;
  domain: string;
  sourceId: string;
  sourceEmail: string | null;
  enabled: boolean;
};

class AdminApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function adminRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      // Keep the status-based message when the server does not return JSON.
    }
    throw new AdminApiError(response.status, message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function statusLabel(status: SourceStatus) {
  return status.replaceAll("_", " ");
}

export default function AdminPanel() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [sourceEmail, setSourceEmail] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceRefreshToken, setSourceRefreshToken] = useState("");
  const [domainName, setDomainName] = useState("");
  const [domainSourceId, setDomainSourceId] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadDashboard() {
    const [sourceResponse, domainResponse] = await Promise.all([
      adminRequest<{ sources: Source[] }>("/api/admin/sources"),
      adminRequest<{ domains: Domain[] }>("/api/admin/domains"),
    ]);
    setSources(sourceResponse.sources);
    setDomains(domainResponse.domains);
    setDomainSourceId((current) => current || sourceResponse.sources[0]?.id || "");
  }

  useEffect(() => {
    let cancelled = false;
    void adminRequest<{ authenticated: boolean }>("/api/admin/session")
      .then(async (result) => {
        if (cancelled) {
          return;
        }
        setAuthenticated(result.authenticated);
        if (result.authenticated) {
          await loadDashboard();
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setAuthenticated(false);
          if (!(requestError instanceof AdminApiError && requestError.status === 401)) {
            setError(requestError instanceof Error ? requestError.message : "Unable to load admin session");
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      await adminRequest("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
      setPassword("");
      setAuthenticated(true);
      await loadDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Login failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function logout() {
    await adminRequest("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setSources([]);
    setDomains([]);
  }

  async function createSource(event: FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      await adminRequest("/api/admin/sources", {
        method: "POST",
        body: JSON.stringify({ email: sourceEmail, label: sourceLabel, refreshToken: sourceRefreshToken }),
      });
      setSourceEmail("");
      setSourceLabel("");
      setSourceRefreshToken("");
      setNotice(sourceRefreshToken ? "Gmail source added and token stored encrypted." : "Gmail source added. Connect it with OAuth to start polling.");
      await loadDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not add Gmail source");
    } finally {
      setIsBusy(false);
    }
  }

  async function connectSource(id: string) {
    setIsBusy(true);
    setError(null);
    try {
      const result = await adminRequest<{ authUrl: string }>(`/api/admin/sources/${encodeURIComponent(id)}/connect`, { method: "POST" });
      window.location.href = result.authUrl;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not start Google OAuth");
      setIsBusy(false);
    }
  }

  async function toggleSource(source: Source) {
    setIsBusy(true);
    setError(null);
    try {
      await adminRequest(`/api/admin/sources/${encodeURIComponent(source.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: source.status === "disabled" ? "active" : "disabled" }),
      });
      await loadDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update Gmail source");
    } finally {
      setIsBusy(false);
    }
  }

  async function createDomain(event: FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      await adminRequest("/api/admin/domains", {
        method: "POST",
        body: JSON.stringify({ domain: domainName, sourceId: domainSourceId }),
      });
      setDomainName("");
      setNotice("Custom domain added. Configure Cloudflare Email Routing manually.");
      await loadDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not add custom domain");
    } finally {
      setIsBusy(false);
    }
  }

  async function toggleDomain(domain: Domain) {
    setIsBusy(true);
    setError(null);
    try {
      await adminRequest(`/api/admin/domains/${encodeURIComponent(domain.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !domain.enabled }),
      });
      await loadDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update custom domain");
    } finally {
      setIsBusy(false);
    }
  }

  if (authenticated === null) {
    return <main className="admin-page"><div className="admin-card">Checking admin session...</div></main>;
  }

  if (!authenticated) {
    return (
      <main className="admin-page">
        <section className="admin-card admin-login-card">
          <span className="admin-kicker">Alias Relay / Admin</span>
          <h1>Private control room</h1>
          <p>Manage Gmail sources and custom domains without exposing account tokens to the browser.</p>
          <form className="admin-form" onSubmit={login}>
            <label htmlFor="admin-password">Password</label>
            <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
            <button className="admin-primary-button" type="submit" disabled={isBusy}>{isBusy ? "Signing in..." : "Sign in"}</button>
          </form>
          {error ? <p className="admin-error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div>
            <span className="admin-kicker">Alias Relay / Admin</span>
            <h1>Relay control room</h1>
            <p>Gmail credentials stay encrypted in the database. Cloudflare forwarding remains a manual DNS operation.</p>
          </div>
          <button className="admin-secondary-button" type="button" onClick={() => void logout()}>Sign out</button>
        </header>

        {error ? <div className="admin-alert admin-error">{error}</div> : null}
        {notice ? <div className="admin-alert admin-notice">{notice}</div> : null}

        <section className="admin-card">
          <div className="admin-section-heading">
            <div><span className="admin-kicker">01 / Gmail sources</span><h2>Connected inboxes</h2></div>
            <span className="admin-count">{sources.length}</span>
          </div>
          <form className="admin-inline-form" onSubmit={createSource}>
            <input type="email" placeholder="source@gmail.com" value={sourceEmail} onChange={(event) => setSourceEmail(event.target.value)} required />
            <input type="text" placeholder="Label (optional)" value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} />
            <input type="password" placeholder="Refresh token (optional)" value={sourceRefreshToken} onChange={(event) => setSourceRefreshToken(event.target.value)} autoComplete="off" />
            <button className="admin-primary-button" type="submit" disabled={isBusy}>Add source</button>
          </form>
          <p className="admin-help">Enter an existing refresh token or leave it blank and connect the source with Google OAuth below. Tokens are encrypted before storage.</p>
          <div className="admin-list">
            {sources.length ? sources.map((source) => (
              <article className="admin-list-row" key={source.id}>
                <div>
                  <strong>{source.label || source.email}</strong>
                  {source.label ? <span>{source.email}</span> : null}
                  <small className={`admin-status status-${source.status}`}>{statusLabel(source.status)}{source.hasRefreshToken ? " / token saved" : " / not connected"}</small>
                  {source.lastError ? <small className="admin-error-text">{source.lastError}</small> : null}
                </div>
                <div className="admin-row-actions">
                  <button className="admin-secondary-button" type="button" onClick={() => void connectSource(source.id)} disabled={isBusy}>{source.hasRefreshToken ? "Reconnect" : "Connect OAuth"}</button>
                  {source.hasRefreshToken ? <button className="admin-text-button" type="button" onClick={() => void toggleSource(source)} disabled={isBusy}>{source.status === "disabled" ? "Enable" : "Disable"}</button> : null}
                </div>
              </article>
            )) : <p className="admin-empty">No Gmail sources configured.</p>}
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-section-heading">
            <div><span className="admin-kicker">02 / Custom domains</span><h2>Cloudflare forwarding aliases</h2></div>
            <span className="admin-count">{domains.length}</span>
          </div>
          <p className="admin-help">Add the domain here, then configure Cloudflare Email Routing with a catch-all rule forwarding to the selected Gmail source.</p>
          <form className="admin-inline-form" onSubmit={createDomain}>
            <input type="text" placeholder="example.com" value={domainName} onChange={(event) => setDomainName(event.target.value)} required />
            <select value={domainSourceId} onChange={(event) => setDomainSourceId(event.target.value)} required>
              <option value="">Select Gmail destination</option>
              {sources.map((source) => <option value={source.id} key={source.id}>{source.label || source.email}</option>)}
            </select>
            <button className="admin-primary-button" type="submit" disabled={isBusy || !domainSourceId}>Add domain</button>
          </form>
          <div className="admin-list">
            {domains.length ? domains.map((domain) => (
              <article className="admin-list-row" key={domain.id}>
                <div>
                  <strong>{domain.domain}</strong>
                  <span>Forward to {domain.sourceEmail || "unknown Gmail source"}</span>
                  <small className={`admin-status ${domain.enabled ? "status-active" : "status-disabled"}`}>{domain.enabled ? "enabled" : "disabled"}</small>
                </div>
                <button className="admin-text-button" type="button" onClick={() => void toggleDomain(domain)} disabled={isBusy}>{domain.enabled ? "Disable" : "Enable"}</button>
              </article>
            )) : <p className="admin-empty">No custom domains configured.</p>}
          </div>
          <div className="admin-instructions">
            <strong>Cloudflare checklist</strong>
            <span>1. Add the domain to Cloudflare DNS.</span>
            <span>2. Enable Email Routing and verify the Gmail destination.</span>
            <span>3. Create a catch-all route to the Gmail source shown above.</span>
            <span>4. Send a test to the generated custom address and confirm the original recipient header is preserved.</span>
          </div>
        </section>
      </div>
    </main>
  );
}
