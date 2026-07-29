-- Preserve existing Supabase Storage objects while routing all new uploads to R2.
alter table public.drive_items
  add column storage_provider text not null default 'supabase';

alter table public.drive_items
  add constraint drive_items_storage_provider_check
  check (storage_provider in ('supabase', 'r2'));

create index drive_items_user_storage_provider_idx
  on public.drive_items (user_id, storage_provider)
  where kind = 'file';

comment on column public.drive_items.storage_provider is
  'Object backend. Existing rows remain in Supabase Storage; new uploads use Cloudflare R2.';
