-- Multi-type capability-link sharing. Anonymous visitors never receive direct
-- table access; a public Edge Function resolves one high-entropy UUID token.
create table public.shares (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  public_id uuid not null default gen_random_uuid() unique,
  share_type text not null check (share_type in ('file', 'text', 'link')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  text_content text,
  link_url text,
  file_id bigint,
  expires_at timestamptz,
  view_count bigint not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  constraint shares_file_owner_fk
    foreign key (file_id, user_id)
    references public.drive_items (id, user_id)
    on delete cascade,
  constraint shares_type_payload_check check (
    (
      share_type = 'file'
      and file_id is not null
      and text_content is null
      and link_url is null
    )
    or
    (
      share_type = 'text'
      and file_id is null
      and text_content is not null
      and char_length(text_content) between 1 and 100000
      and link_url is null
    )
    or
    (
      share_type = 'link'
      and file_id is null
      and text_content is null
      and link_url is not null
      and char_length(link_url) between 8 and 2048
      and link_url ~* '^https?://'
    )
  ),
  constraint shares_expiry_check check (
    expires_at is null or expires_at > created_at
  )
);

create index shares_user_created_idx
  on public.shares (user_id, created_at desc);

create index shares_file_idx
  on public.shares (file_id)
  where file_id is not null;

alter table public.shares enable row level security;

create policy "Users can read their own shares"
on public.shares
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own shares"
on public.shares
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own shares"
on public.shares
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.shares from public, anon;
grant select, insert, delete on table public.shares to authenticated;
grant select, insert, update, delete on table public.shares to service_role;

revoke all on sequence public.shares_id_seq from public, anon;
grant usage, select on sequence public.shares_id_seq to authenticated, service_role;

create or replace function public.increment_share_view(p_share_id bigint)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.shares
  set view_count = view_count + 1
  where id = p_share_id;
$$;

revoke all on function public.increment_share_view(bigint)
from public, anon, authenticated;
grant execute on function public.increment_share_view(bigint) to service_role;
