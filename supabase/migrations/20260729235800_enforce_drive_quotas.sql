-- R2 free-tier allocation:
-- - 10 GB hard account pool (decimal bytes, matching provider billing)
-- - each non-admin account may use up to 200 MB
-- - the administrator may use the unallocated pool:
--   10 GiB - (200 MiB * non-admin account count)
--
-- Upload reservations make quota checks atomic before a browser receives any
-- multipart URLs. Only service-role Netlify Functions can mutate reservations.

create schema if not exists xiaopan_private;
revoke all on schema xiaopan_private from public, anon, authenticated;

create table public.drive_upload_reservations (
  storage_path text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  size bigint not null check (size >= 0 and size <= 5497558138880),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  constraint drive_upload_reservations_owner_path_check
    check (storage_path like user_id::text || '/%')
);

create index drive_upload_reservations_user_expiry_idx
  on public.drive_upload_reservations (user_id, expires_at);

create index drive_upload_reservations_expiry_idx
  on public.drive_upload_reservations (expires_at);

alter table public.drive_upload_reservations enable row level security;
revoke all on table public.drive_upload_reservations from public, anon, authenticated;
grant select, insert, update, delete on table public.drive_upload_reservations to service_role;

create or replace function xiaopan_private.drive_quota_for(p_user_id uuid)
returns table (
  quota_bytes bigint,
  used_bytes bigint,
  reserved_bytes bigint,
  remaining_bytes bigint,
  is_admin boolean,
  personal_user_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with constants as (
    select
      10000000000::bigint as total_bytes,
      200000000::bigint as personal_bytes
  ),
  identity as (
    select exists (
      select 1
      from auth.users as auth_user
      join public.admin_users as administrator
        on administrator.email = lower(auth_user.email)
      where auth_user.id = p_user_id
    ) as is_admin
  ),
  people as (
    select count(*)::bigint as personal_user_count
    from auth.users as auth_user
    where not exists (
      select 1
      from public.admin_users as administrator
      where administrator.email = lower(auth_user.email)
    )
  ),
  per_user as (
    select
      coalesce(sum(item.size), 0)::bigint as used_bytes
    from public.drive_items as item
    where item.user_id = p_user_id
      and item.kind = 'file'
  ),
  per_user_reserved as (
    select
      coalesce(sum(reservation.size), 0)::bigint as reserved_bytes
    from public.drive_upload_reservations as reservation
    where reservation.user_id = p_user_id
      and reservation.expires_at > now()
  ),
  global_usage as (
    select
      coalesce(sum(item.size), 0)::bigint as used_bytes
    from public.drive_items as item
    where item.kind = 'file'
  ),
  global_reserved as (
    select
      coalesce(sum(reservation.size), 0)::bigint as reserved_bytes
    from public.drive_upload_reservations as reservation
    where reservation.expires_at > now()
  ),
  allocation as (
    select
      case
        when identity.is_admin then greatest(
          constants.total_bytes - people.personal_user_count * constants.personal_bytes,
          0
        )
        else constants.personal_bytes
      end::bigint as quota_bytes,
      constants.total_bytes,
      identity.is_admin,
      people.personal_user_count,
      per_user.used_bytes,
      per_user_reserved.reserved_bytes,
      global_usage.used_bytes as global_used_bytes,
      global_reserved.reserved_bytes as global_reserved_bytes
    from constants
    cross join identity
    cross join people
    cross join per_user
    cross join per_user_reserved
    cross join global_usage
    cross join global_reserved
  )
  select
    allocation.quota_bytes,
    allocation.used_bytes,
    allocation.reserved_bytes,
    greatest(
      least(
        allocation.quota_bytes - allocation.used_bytes - allocation.reserved_bytes,
        allocation.total_bytes - allocation.global_used_bytes - allocation.global_reserved_bytes
      ),
      0
    )::bigint as remaining_bytes,
    allocation.is_admin,
    allocation.personal_user_count
  from allocation;
$$;

revoke all on function xiaopan_private.drive_quota_for(uuid)
  from public, anon, authenticated;

create or replace function public.drive_quota()
returns table (
  quota_bytes bigint,
  used_bytes bigint,
  reserved_bytes bigint,
  remaining_bytes bigint,
  is_admin boolean,
  personal_user_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  return query
  select *
  from xiaopan_private.drive_quota_for(current_user_id);
end;
$$;

revoke all on function public.drive_quota() from public, anon;
grant execute on function public.drive_quota() to authenticated;

create or replace function public.reserve_drive_upload(
  p_user_id uuid,
  p_storage_path text,
  p_size bigint
)
returns table (
  quota_bytes bigint,
  used_bytes bigint,
  reserved_bytes bigint,
  remaining_bytes bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  quota_row record;
begin
  if p_user_id is null
    or p_storage_path not like p_user_id::text || '/%'
    or p_size is null
    or p_size < 0
    or p_size > 5497558138880
  then
    raise exception 'Invalid upload reservation';
  end if;

  -- One account-wide lock protects both per-user and global free-tier limits.
  perform pg_catalog.pg_advisory_xact_lock(934857201);

  delete from public.drive_upload_reservations
  where expires_at <= now();

  select *
  into quota_row
  from xiaopan_private.drive_quota_for(p_user_id);

  if p_size > quota_row.remaining_bytes then
    raise exception 'Storage quota exceeded. Remaining bytes: %', quota_row.remaining_bytes
      using errcode = 'P0001';
  end if;

  insert into public.drive_upload_reservations (
    storage_path,
    user_id,
    size
  )
  values (
    p_storage_path,
    p_user_id,
    p_size
  );

  return query
  select
    quota_row.quota_bytes::bigint,
    quota_row.used_bytes::bigint,
    (quota_row.reserved_bytes + p_size)::bigint,
    (quota_row.remaining_bytes - p_size)::bigint;
end;
$$;

revoke all on function public.reserve_drive_upload(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_drive_upload(uuid, text, bigint)
  to service_role;

create or replace function public.finalize_drive_upload(
  p_user_id uuid,
  p_storage_path text,
  p_parent_id bigint,
  p_name text,
  p_size bigint,
  p_mime_type text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved_size bigint;
  created_id bigint;
  clean_name text := btrim(p_name);
begin
  perform pg_catalog.pg_advisory_xact_lock(934857201);

  select reservation.size
  into reserved_size
  from public.drive_upload_reservations as reservation
  where reservation.storage_path = p_storage_path
    and reservation.user_id = p_user_id
    and reservation.expires_at > now()
  for update;

  if reserved_size is null or reserved_size <> p_size then
    raise exception 'Upload reservation is missing or does not match';
  end if;

  if clean_name is null
    or char_length(clean_name) not between 1 and 255
    or clean_name in ('.', '..')
    or position('/' in clean_name) > 0
  then
    raise exception 'Invalid file name';
  end if;

  insert into public.drive_items (
    user_id,
    parent_id,
    kind,
    name,
    size,
    mime_type,
    storage_path,
    storage_provider
  )
  values (
    p_user_id,
    p_parent_id,
    'file',
    clean_name,
    p_size,
    coalesce(nullif(p_mime_type, ''), 'application/octet-stream'),
    p_storage_path,
    'r2'
  )
  returning id into created_id;

  delete from public.drive_upload_reservations
  where storage_path = p_storage_path
    and user_id = p_user_id;

  return created_id;
end;
$$;

revoke all on function public.finalize_drive_upload(
  uuid, text, bigint, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.finalize_drive_upload(
  uuid, text, bigint, text, bigint, text
) to service_role;
