-- Resolve only active public file shares without exposing owner information.
-- The Netlify public-download function uses this narrow RPC to sign R2 objects
-- without storing a Supabase service-role key in Netlify.

create or replace function public.resolve_public_file_share(
  p_public_id uuid
)
returns table (
  file_name text,
  storage_path text,
  storage_provider text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    item.name as file_name,
    item.storage_path,
    item.storage_provider
  from public.shares as share
  join public.drive_items as item
    on item.id = share.file_id
   and item.kind = 'file'
  where share.public_id = p_public_id
    and share.share_type = 'file'
    and (share.expires_at is null or share.expires_at > now())
    and item.storage_path is not null
  limit 1;
$$;

revoke all on function public.resolve_public_file_share(uuid) from public;
grant execute on function public.resolve_public_file_share(uuid)
  to anon, authenticated, service_role;
