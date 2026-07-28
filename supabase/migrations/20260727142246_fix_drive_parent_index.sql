drop index if exists public.drive_items_user_parent_idx;

create index if not exists drive_items_parent_user_idx
  on public.drive_items (parent_id, user_id);
