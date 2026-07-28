-- Private cross-device text clipboard. Each authenticated user can only read,
-- create and delete their own entries. Postgres Changes provides live refresh.
create table if not exists public.quick_texts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (
    char_length(btrim(content)) between 1 and 100000
  ),
  created_at timestamptz not null default now()
);

create index if not exists quick_texts_user_created_idx
  on public.quick_texts (user_id, created_at desc);

alter table public.quick_texts enable row level security;

drop policy if exists "Users can read their own quick texts"
on public.quick_texts;
create policy "Users can read their own quick texts"
on public.quick_texts
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own quick texts"
on public.quick_texts;
create policy "Users can create their own quick texts"
on public.quick_texts
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own quick texts"
on public.quick_texts;
create policy "Users can delete their own quick texts"
on public.quick_texts
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.quick_texts from public, anon;
grant select, insert, delete on table public.quick_texts to authenticated;
grant select, insert, update, delete on table public.quick_texts to service_role;

revoke all on sequence public.quick_texts_id_seq from public, anon;
grant usage, select on sequence public.quick_texts_id_seq
to authenticated, service_role;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'quick_texts'
  ) then
    alter publication supabase_realtime add table public.quick_texts;
  end if;
end
$$;
