# Gmail Nator

Temporary Gmail alias frontend and MVP backend based on `PRD_Temp_Mail_Gmail_Alias_Trick_v1.md`.

## Local Setup

```bash
npm install
cp .env.example .env
npm run backend:dev
npm run dev
```

The frontend runs on `http://localhost:3000` and the API runs on `http://localhost:4000`.
Without Supabase credentials, the API uses in-memory storage for local development. Without Gmail OAuth credentials, Gmail polling stays disabled.

## Supabase

Run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL editor, then set:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

The service-role key must only exist in the backend environment.

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
