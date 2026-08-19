"use client";

import { FormEvent, useEffect, useState } from "react";
import { ApiError, apiRequest } from "../api";

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

function statusLabel(status: SourceStatus) {
  return status.replaceAll("_", " ");
}

function formatLastPolled(value: string | null) {
  if (!value) {
    return "Awaiting first poll";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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

  const connectedSources = sources.filter((source) => source.hasRefreshToken && source.status !== "disabled").length;
  const enabledDomains = domains.filter((domain) => domain.enabled).length;
  const sourcesNeedingAttention = sources.filter((source) => source.status === "error" || source.status === "reauth_required").length;

  async function loadDashboard() {
    const [sourceResponse, domainResponse] = await Promise.all([
      apiRequest<{ sources: Source[] }>("/api/admin/sources"),
      apiRequest<{ domains: Domain[] }>("/api/admin/domains"),
    ]);
    setSources(sourceResponse.sources);
    setDomains(domainResponse.domains);
    setDomainSourceId((current) => current || sourceResponse.sources[0]?.id || "");
  }

  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ authenticated: boolean }>("/api/admin/session")
      .then((result) => {
        if (cancelled) {
          return;
        }
        setAuthenticated(result.authenticated);
        if (result.authenticated) {
          void loadDashboard().catch((requestError: unknown) => {
            if (!cancelled) {
              setError(requestError instanceof Error ? requestError.message : "Unable to load admin dashboard");
            }
          });
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setAuthenticated(false);
          if (!(requestError instanceof ApiError && requestError.status === 401)) {
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
      await apiRequest("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
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
    await apiRequest("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setSources([]);
    setDomains([]);
  }

  async function createSource(event: FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      await apiRequest("/api/admin/sources", {
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
      const result = await apiRequest<{ authUrl: string }>(`/api/admin/sources/${encodeURIComponent(id)}/connect`, { method: "POST" });
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
      await apiRequest(`/api/admin/sources/${encodeURIComponent(source.id)}`, {
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
      await apiRequest("/api/admin/domains", {
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
      await apiRequest(`/api/admin/domains/${encodeURIComponent(domain.id)}`, {
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
    return (
      <main className="admin-page">
        <div className="admin-card admin-loading-card">
          <span className="admin-brand-mark" aria-hidden="true">AR</span>
          <span className="admin-kicker">Alias Relay / Admin</span>
          <p><span className="admin-loading-dot" />Checking secure session...</p>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="admin-page">
        <section className="admin-card admin-login-card">
          <div className="admin-login-intro">
            <span className="admin-brand-mark" aria-hidden="true">AR</span>
            <span className="admin-kicker">Private workspace</span>
          </div>
          <h1>Welcome back<span>.</span></h1>
          <p>Manage Gmail sources and custom domains from one secure control room.</p>
          <form className="admin-form" onSubmit={login}>
            <label className="admin-field" htmlFor="admin-password">
              <span>Password</span>
              <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
            </label>
            <button className="admin-primary-button" type="submit" disabled={isBusy}>{isBusy ? "Signing in..." : "Sign in"}</button>
          </form>
          <div className="admin-security-note"><span aria-hidden="true">✦</span> Your session is protected with an httpOnly cookie.</div>
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-header-copy">
            <div className="admin-brandline">
              <span className="admin-brand-mark" aria-hidden="true">AR</span>
              <span>Alias Relay / Operations</span>
            </div>
            <span className="admin-kicker">Private workspace / 01</span>
            <h1>Relay control room</h1>
            <p>Keep inbox connections healthy and route custom aliases with confidence.</p>
          </div>
          <div className="admin-header-actions">
            <span className="admin-secure-label"><span className="admin-secure-dot" />Encrypted storage</span>
            <a className="admin-secondary-button" href="/">View public inbox</a>
            <button className="admin-secondary-button" type="button" onClick={() => void logout()}>Sign out</button>
          </div>
        </header>

        {error ? <div className="admin-alert admin-error" role="alert">{error}</div> : null}
        {notice ? <div className="admin-alert admin-notice" role="status">{notice}</div> : null}

        <section className="admin-overview" aria-label="Workspace overview">
          <div className="admin-overview-heading">
            <span className="admin-kicker">At a glance</span>
            <p>Operational status across your relay setup.</p>
          </div>
          <div className="admin-stat-grid">
            <div className="admin-stat-card">
              <span className="admin-stat-index">01</span>
              <span className="admin-stat-label">Gmail sources</span>
              <strong>{String(sources.length).padStart(2, "0")}</strong>
              <small>{connectedSources} connected and ready</small>
            </div>
            <div className="admin-stat-card admin-stat-card-blue">
              <span className="admin-stat-index">02</span>
              <span className="admin-stat-label">Domain routes</span>
              <strong>{String(domains.length).padStart(2, "0")}</strong>
              <small>{enabledDomains} forwarding routes enabled</small>
            </div>
            <div className={`admin-stat-card ${sourcesNeedingAttention ? "admin-stat-card-alert" : "admin-stat-card-lime"}`}>
              <span className="admin-stat-index">03</span>
              <span className="admin-stat-label">Needs attention</span>
              <strong>{String(sourcesNeedingAttention).padStart(2, "0")}</strong>
              <small>{sourcesNeedingAttention ? "Check a source below" : "Everything looks healthy"}</small>
            </div>
          </div>
        </section>

        <section className="admin-card admin-section-card">
          <div className="admin-section-heading">
            <div><span className="admin-kicker">01 / Gmail sources</span><h2>Connected inboxes</h2><p>Choose where incoming alias mail should land.</p></div>
            <span className="admin-count"><strong>{sources.length}</strong><small>total</small></span>
          </div>
          <form className="admin-inline-form admin-source-form" onSubmit={createSource}>
            <label className="admin-field">
              <span>Gmail address</span>
              <input type="email" placeholder="source@gmail.com" value={sourceEmail} onChange={(event) => setSourceEmail(event.target.value)} required />
            </label>
            <label className="admin-field">
              <span>Label <em>optional</em></span>
              <input type="text" placeholder="Personal inbox" value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} />
            </label>
            <label className="admin-field admin-field-wide">
              <span>Refresh token <em>optional</em></span>
              <input type="password" placeholder="Paste an existing token" value={sourceRefreshToken} onChange={(event) => setSourceRefreshToken(event.target.value)} autoComplete="off" />
            </label>
            <button className="admin-primary-button" type="submit" disabled={isBusy}>Add source <span aria-hidden="true">↗</span></button>
          </form>
          <p className="admin-help"><span aria-hidden="true">↳</span> Enter an existing refresh token or leave it blank and connect with Google OAuth below. Tokens are encrypted before storage.</p>
          <div className="admin-list">
            <div className="admin-list-header"><span>Configured sources</span><span>{sources.length ? `${connectedSources} ready` : "No connections yet"}</span></div>
            {sources.length ? sources.map((source) => (
              <article className="admin-list-row" key={source.id}>
                <div className={`admin-row-icon admin-row-icon-${source.status}`} aria-hidden="true">G</div>
                <div className="admin-row-content">
                  <strong>{source.label || source.email}</strong>
                  {source.label ? <span>{source.email}</span> : null}
                  <div className="admin-row-meta">
                    <small className={`admin-status status-${source.status}`}>{statusLabel(source.status)}</small>
                    <small>{source.hasRefreshToken ? "Token saved" : "Not connected"}</small>
                    <small>Last poll: {formatLastPolled(source.lastPolledAt)}</small>
                  </div>
                  {source.lastError ? <small className="admin-error-text">{source.lastError}</small> : null}
                </div>
                <div className="admin-row-actions">
                  <button className="admin-secondary-button" type="button" onClick={() => void connectSource(source.id)} disabled={isBusy}>{source.hasRefreshToken ? "Reconnect" : "Connect OAuth"}</button>
                  {source.hasRefreshToken ? <button className="admin-text-button" type="button" onClick={() => void toggleSource(source)} disabled={isBusy}>{source.status === "disabled" ? "Enable" : "Disable"}</button> : null}
                </div>
              </article>
            )) : <div className="admin-empty"><span className="admin-empty-mark" aria-hidden="true">G</span><div><strong>No Gmail sources yet</strong><p>Add a source above to start routing alias mail.</p></div></div>}
          </div>
        </section>

        <section className="admin-card admin-section-card">
          <div className="admin-section-heading">
            <div><span className="admin-kicker">02 / Custom domains</span><h2>Cloudflare forwarding aliases</h2><p>Connect a domain to one of your Gmail destinations.</p></div>
            <span className="admin-count"><strong>{domains.length}</strong><small>total</small></span>
          </div>
          <form className="admin-inline-form" onSubmit={createDomain}>
            <label className="admin-field">
              <span>Domain</span>
              <input type="text" placeholder="example.com" value={domainName} onChange={(event) => setDomainName(event.target.value)} required />
            </label>
            <label className="admin-field admin-field-wide">
              <span>Gmail destination</span>
              <select value={domainSourceId} onChange={(event) => setDomainSourceId(event.target.value)} required>
                <option value="">Select a destination</option>
                {sources.map((source) => <option value={source.id} key={source.id}>{source.label || source.email}</option>)}
              </select>
            </label>
            <button className="admin-primary-button" type="submit" disabled={isBusy || !domainSourceId}>Add domain <span aria-hidden="true">↗</span></button>
          </form>
          <p className="admin-help"><span aria-hidden="true">↳</span> Add the domain here, then configure Cloudflare Email Routing with a catch-all rule pointing to the selected Gmail source.</p>
          <div className="admin-list">
            <div className="admin-list-header"><span>Configured routes</span><span>{domains.length ? `${enabledDomains} enabled` : "No routes yet"}</span></div>
            {domains.length ? domains.map((domain) => (
              <article className="admin-list-row" key={domain.id}>
                <div className="admin-row-icon admin-row-icon-domain" aria-hidden="true">@</div>
                <div className="admin-row-content">
                  <strong>{domain.domain}</strong>
                  <span>Forward to {domain.sourceEmail || "unknown Gmail source"}</span>
                  <div className="admin-row-meta">
                    <small className={`admin-status ${domain.enabled ? "status-active" : "status-disabled"}`}>{domain.enabled ? "Enabled" : "Disabled"}</small>
                    <small>Catch-all route</small>
                  </div>
                </div>
                <button className="admin-text-button" type="button" onClick={() => void toggleDomain(domain)} disabled={isBusy}>{domain.enabled ? "Disable" : "Enable"}</button>
              </article>
            )) : <div className="admin-empty"><span className="admin-empty-mark" aria-hidden="true">@</span><div><strong>No custom domains yet</strong><p>Add a domain above after connecting a Gmail destination.</p></div></div>}
          </div>
          <div className="admin-instructions">
            <div className="admin-instructions-heading"><div><span className="admin-kicker">Manual setup</span><strong>Cloudflare checklist</strong></div><span>4 steps</span></div>
            <ol>
              <li>Add the domain to Cloudflare DNS.</li>
              <li>Enable Email Routing and verify the Gmail destination.</li>
              <li>Create a catch-all route to the Gmail source shown above.</li>
              <li>Send a test and confirm the original recipient header is preserved.</li>
            </ol>
          </div>
        </section>
      </div>
    </main>
  );
}
