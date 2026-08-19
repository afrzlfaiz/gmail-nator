create extension if not exists pgcrypto;

create table if not exists public.mailboxes (
    id uuid primary key default gen_random_uuid(),
    address text unique not null,
    trick_type text not null check (trick_type in ('dot', 'plus')),
    created_at timestamptz not null default now()
);

create index if not exists idx_mailboxes_address
    on public.mailboxes (lower(address));

create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),
    mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
    gmail_message_id text unique not null,
    sender text,
    recipient text,
    subject text,
    snippet text,
    body_html text,
    body_text text,
    received_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_messages_mailbox
    on public.messages (mailbox_id);

create index if not exists idx_messages_mailbox_received
    on public.messages (mailbox_id, received_at desc, created_at desc);

create index if not exists idx_messages_received
    on public.messages (received_at);

alter table public.mailboxes enable row level security;
alter table public.messages enable row level security;

create or replace function public.trim_mailbox_messages(
    target_mailbox uuid,
    keep_limit integer default 20
)
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.messages
    where mailbox_id = target_mailbox
      and id not in (
          select id
          from public.messages
          where mailbox_id = target_mailbox
          order by received_at desc nulls last, created_at desc
          limit keep_limit
      );
$$;

revoke all on function public.trim_mailbox_messages(uuid, integer) from public;
grant execute on function public.trim_mailbox_messages(uuid, integer) to service_role;
