# Gmail Nator

Temporary Gmail alias frontend and MVP backend based on `PRD_Temp_Mail_Gmail_Alias_Trick_v1.md`.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev:all
```

The frontend runs on `http://localhost:3000`, while Next.js proxies `/api/*` to the Express service on `http://localhost:4000`.
Without `DATABASE_URL`, the API uses in-memory storage for local development. Without Gmail OAuth credentials, Gmail polling stays disabled.

To run the services separately, use `npm run backend:dev` and `npm run dev` in two terminals.

For separate deployed services, set `BACKEND_URL` while building the frontend. `NEXT_PUBLIC_API_URL` can be set to the public API URL when the browser must bypass the Next.js proxy.

## Supabase Session Pooler

Run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL editor, then set only the session pooler URI:

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

Set `DATABASE_URL`, Gmail variables, and `CORS_ORIGIN` in the Render environment settings. Leave `BACKEND_URL` and `NEXT_PUBLIC_API_URL` empty for this single-service setup. If the frontend is deployed as a separate service, set `BACKEND_URL` to the public API service URL while building the Next.js app.

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

## Gmail Worker

Set all Gmail variables in `.env` to enable the incremental History API poller:

```env
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REDIRECT_URI=http://localhost:4000/oauth2/callback
GMAIL_REFRESH_TOKEN=
GMAIL_SOURCE_EMAIL=ahmadrizal@gmail.com
```

The backend stores the Gmail `historyId` checkpoint in `app_state`, reads recipient headers, stores parsed bodies, trims each mailbox to 20 messages, and removes messages older than 7 days.

## Verification

```bash
npm run typecheck
npm run build
npm run backend:build
```

Useful endpoints:

- `GET /api/health`
- `POST /api/mailboxes` with `{ "type": "plus" }`
- `GET /api/mailboxes/:address/messages`
- `GET /api/messages/:id`
- `DELETE /api/messages/:id`
