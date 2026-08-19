create table if not exists public.gmail_sources (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    label text,
    status text not null default 'pending' check (status in ('pending', 'active', 'disabled', 'reauth_required', 'error')),
    refresh_token_ciphertext text,
    refresh_token_iv text,
    refresh_token_tag text,
    history_id text,
    last_polled_at timestamptz,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists idx_gmail_sources_email
    on public.gmail_sources (lower(email));

create table if not exists public.admin_credentials (
    id integer primary key default 1 check (id = 1),
    password_hash text not null,
    updated_at timestamptz not null default now()
);

create table if not exists public.admin_sessions (
    token_hash text primary key,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_admin_sessions_expiry
    on public.admin_sessions (expires_at);

create table if not exists public.oauth_states (
    state_hash text primary key,
    session_token_hash text not null,
    source_id uuid not null references public.gmail_sources(id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_oauth_states_expiry
    on public.oauth_states (expires_at);

create table if not exists public.custom_domains (
    id uuid primary key default gen_random_uuid(),
    domain text not null,
    source_id uuid not null references public.gmail_sources(id) on delete restrict,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists idx_custom_domains_domain
    on public.custom_domains (lower(domain));

alter table public.mailboxes add column if not exists source_id uuid;
alter table public.mailboxes add column if not exists domain_id uuid;
alter table public.messages add column if not exists source_id uuid;

alter table public.mailboxes drop constraint if exists mailboxes_trick_type_check;
alter table public.mailboxes
    add constraint mailboxes_trick_type_check check (trick_type in ('dot', 'plus', 'mixed', 'custom'));

alter table public.messages drop constraint if exists messages_gmail_message_id_key;

do $$
begin
    alter table public.mailboxes
        add constraint mailboxes_source_fk foreign key (source_id) references public.gmail_sources(id) on delete restrict;
exception
    when duplicate_object then null;
end $$;

do $$
begin
    alter table public.mailboxes
        add constraint mailboxes_domain_fk foreign key (domain_id) references public.custom_domains(id) on delete restrict;
exception
    when duplicate_object then null;
end $$;

do $$
begin
    alter table public.messages
        add constraint messages_source_fk foreign key (source_id) references public.gmail_sources(id) on delete restrict;
exception
    when duplicate_object then null;
end $$;

create index if not exists idx_mailboxes_source
    on public.mailboxes (source_id);

create index if not exists idx_mailboxes_domain
    on public.mailboxes (domain_id);

create unique index if not exists idx_messages_source_gmail_mailbox
    on public.messages (source_id, gmail_message_id, mailbox_id)
    where source_id is not null;

alter table public.gmail_sources enable row level security;
alter table public.admin_credentials enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.oauth_states enable row level security;
alter table public.custom_domains enable row level security;
