-- Server-side administrator allowlist. This table is exposed through the
-- public schema only so the service-role Edge Function can query it; browser
-- roles receive no table privileges and RLS has no client policies.
create table public.admin_users (
  id bigint generated always as identity primary key,
  email text not null unique check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 320
    and position('@' in email) > 1
  ),
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

revoke all on table public.admin_users from public, anon, authenticated;
revoke all on sequence public.admin_users_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_users to service_role;
grant usage, select on sequence public.admin_users_id_seq to service_role;

insert into public.admin_users (email)
values ('raimanncostigan@gmail.com')
on conflict (email) do nothing;

-- Return per-user drive totals without granting the browser access to any
-- other user's metadata. Only the service role used inside the verified Edge
-- Function can execute this routine.
create or replace function public.admin_drive_usage()
returns table (
  user_id uuid,
  used_bytes bigint,
  file_count bigint,
  folder_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    item.user_id,
    coalesce(sum(item.size) filter (where item.kind = 'file'), 0)::bigint,
    count(*) filter (where item.kind = 'file')::bigint,
    count(*) filter (where item.kind = 'folder')::bigint
  from public.drive_items as item
  group by item.user_id;
$$;

revoke all on function public.admin_drive_usage() from public, anon, authenticated;
grant execute on function public.admin_drive_usage() to service_role;
