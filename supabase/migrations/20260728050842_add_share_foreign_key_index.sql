drop index if exists public.shares_file_idx;

create index shares_file_user_idx
  on public.shares (file_id, user_id)
  where file_id is not null;
