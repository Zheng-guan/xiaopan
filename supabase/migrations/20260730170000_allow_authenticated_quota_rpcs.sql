-- Let the authenticated R2 signing function reserve and finalize quota through
-- the caller's own JWT. SECURITY DEFINER is still required because reservation
-- rows are intentionally invisible through the Data API.

create or replace function xiaopan_private.assert_drive_quota_caller(
  p_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text := (select auth.role());
begin
  if caller_id is not null then
    if caller_id <> p_user_id then
      raise exception 'A user may only manage their own upload quota'
        using errcode = '42501';
    end if;
  elsif caller_role is distinct from 'service_role' then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function xiaopan_private.assert_drive_quota_caller(uuid)
  from public, anon, authenticated;

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
  perform xiaopan_private.assert_drive_quota_caller(p_user_id);

  if p_user_id is null
    or p_storage_path not like p_user_id::text || '/%'
    or p_size is null
    or p_size < 0
    or p_size > 5497558138880
  then
    raise exception 'Invalid upload reservation';
  end if;

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
  from public, anon;
grant execute on function public.reserve_drive_upload(uuid, text, bigint)
  to authenticated, service_role;

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
  perform xiaopan_private.assert_drive_quota_caller(p_user_id);
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
) from public, anon;
grant execute on function public.finalize_drive_upload(
  uuid, text, bigint, text, bigint, text
) to authenticated, service_role;

create or replace function public.release_drive_upload(
  p_user_id uuid,
  p_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer;
begin
  perform xiaopan_private.assert_drive_quota_caller(p_user_id);

  delete from public.drive_upload_reservations
  where user_id = p_user_id
    and storage_path = p_storage_path;

  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

revoke all on function public.release_drive_upload(uuid, text)
  from public, anon;
grant execute on function public.release_drive_upload(uuid, text)
  to authenticated, service_role;
