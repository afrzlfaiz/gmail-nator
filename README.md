# Gmail Nator

Temporary Gmail alias frontend and MVP backend based on `PRD_Temp_Mail_Gmail_Alias_Trick_v1.md`.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev:all
```

The frontend runs on `http://localhost:3000`, while Next.js proxies `/api/*` to the Express service on `http://localhost:4000`.
Without `DATABASE_URL`, the API uses in-memory storage for local development only. Production requires PostgreSQL because admin credentials, Gmail sources, encrypted refresh tokens, domains, and sessions are database-backed.

To run the services separately, use `npm run backend:dev` and `npm run dev` in two terminals.

For separate deployed services, set `BACKEND_URL` while building the frontend. `NEXT_PUBLIC_API_URL` can be set to the public API URL when the browser must bypass the Next.js proxy.

## Supabase Session Pooler

Run `supabase/migrations/001_initial_schema.sql` and then `supabase/migrations/002_admin_sources_domains.sql` in the Supabase SQL editor, then set only the session pooler URI:

```env
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Use Supabase session mode on port `5432`. Do not use the transaction pooler port `6543` for this persistent Node.js pool.

The backend uses `pg.Pool` with parameterized SQL queries. No Supabase URL, anon key, or service-role key is required.

## Render

The default production start command serves both the Express API and the Next.js frontend from one Render Web Service:

```text
Build command: npm ci && npm run build:all
Start command: npm run backend:start
```

Set `DATABASE_URL`, Google OAuth application credentials, `GMAIL_TOKEN_ENCRYPTION_KEY`, `ADMIN_PASSWORD_HASH`, and `CORS_ORIGIN` in the Render environment settings. Leave `BACKEND_URL` and `NEXT_PUBLIC_API_URL` empty for this single-service setup. If the frontend is deployed as a separate service, set `BACKEND_URL` and `ADMIN_APP_URL` accordingly.

`render.yaml` contains the matching Render Blueprint configuration.

## GitHub Actions

Two workflows run on push to `main`:

- `.github/workflows/ci.yml` — installs dependencies, runs `npm run typecheck`, and builds the frontend and backend.
- `.github/workflows/docker-publish.yml` — builds the Docker image and publishes it to GitHub Container Registry:

```text
ghcr.io/afrzlfaiz/gmail-nator
```

Tags published:

- `latest` for every push to `main`
- `vX.Y.Z` for semver tags
- `sha-<long-sha>` for every build

The publish workflow also triggers a Render deploy when the `RENDER_DEPLOY_HOOK` repository secret is configured. Add the secret in `Settings > Secrets and variables > Actions`, with the value from `Dashboard > Service > Settings > Deploy Hook`.

A `.dockerignore` keeps the Docker build context clean (no `node_modules`, `.next`, `dist-server`, or `.env`).

## Admin And Gmail Sources

Open `http://localhost:3000/admin` and sign in with the configured bootstrap password. Set the Google OAuth application credentials and callback URI first:

```env
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REDIRECT_URI=http://localhost:4000/oauth2/callback
GMAIL_TOKEN_ENCRYPTION_KEY=
ADMIN_PASSWORD_HASH=
ADMIN_APP_URL=http://localhost:3000
```

Add each `@gmail.com` source in the admin panel and use **Connect OAuth**, or paste an existing refresh token into the optional token field. The refresh token is encrypted before it is stored in PostgreSQL. `ADMIN_INITIAL_PASSWORD` may be used once instead of `ADMIN_PASSWORD_HASH`; remove it after the first successful login.

The public generator randomly selects an active, ready Gmail source for dot, plus, and mixed aliases. Mixed aliases use a format such as `a.b+c123@gmail.com`.

## Custom Domains

Add a custom domain in the admin panel and select its Gmail destination. Configure Cloudflare Email Routing manually with a verified destination and catch-all forwarding rule. The public generator randomly selects an enabled custom domain and creates an address such as `tag123456@your-domain.com`.

The forwarded Gmail message must preserve the original recipient in a recipient header. The parser checks `X-Original-Recipient`, `Delivered-To`, `X-Original-To`, `Envelope-To`, `To`, and `Cc`.

## Verification

```bash
npm run typecheck
npm run build
npm run backend:build
```

Useful endpoints:

- `GET /api/health`
- `POST /api/mailboxes` with `{ "type": "plus" }`, `{ "type": "mixed" }`, or `{ "type": "custom" }`
- `GET /api/mailboxes/:address/messages`
- `GET /api/messages/:id`
- `DELETE /api/messages/:id`
