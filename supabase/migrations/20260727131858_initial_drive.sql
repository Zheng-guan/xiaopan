-- Xiaopan personal drive: private object storage + user-scoped metadata.
-- The browser only receives a publishable key. Every data path is protected
-- again at the database and Storage layers by auth.uid().

insert into storage.buckets (id, name, public)
values ('drive', 'drive', false)
on conflict (id) do update
set public = false;

create table public.drive_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id bigint,
  kind text not null check (kind in ('file', 'folder')),
  name text not null check (
    char_length(name) between 1 and 255
    and name not in ('.', '..')
    and position('/' in name) = 0
  ),
  size bigint not null default 0 check (size >= 0),
  mime_type text,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drive_items_id_user_unique unique (id, user_id),
  constraint drive_items_parent_owner_fk
    foreign key (parent_id, user_id)
    references public.drive_items (id, user_id)
    on delete cascade,
  constraint drive_items_kind_fields_check check (
    (
      kind = 'folder'
      and size = 0
      and storage_path is null
    )
    or
    (
      kind = 'file'
      and storage_path is not null
      and storage_path like user_id::text || '/%'
    )
  )
);

create unique index drive_items_sibling_name_unique
  on public.drive_items (user_id, parent_id, lower(name))
  nulls not distinct;

create unique index drive_items_storage_path_unique
  on public.drive_items (storage_path)
  where storage_path is not null;

create index drive_items_parent_user_idx
  on public.drive_items (parent_id, user_id);

create index drive_items_user_updated_idx
  on public.drive_items (user_id, updated_at desc);

create or replace function public.drive_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger drive_items_set_updated_at
before update on public.drive_items
for each row execute function public.drive_set_updated_at();

create or replace function public.drive_validate_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_kind text;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A folder cannot be its own parent';
  end if;

  select item.kind
  into parent_kind
  from public.drive_items as item
  where item.id = new.parent_id
    and item.user_id = new.user_id;

  if parent_kind is distinct from 'folder' then
    raise exception 'Parent must be a folder owned by the same user';
  end if;

  if tg_op = 'UPDATE' and old.kind = 'folder' and new.parent_id is distinct from old.parent_id then
    if exists (
      with recursive descendants as (
        select child.id
        from public.drive_items as child
        where child.parent_id = old.id
          and child.user_id = old.user_id
        union all
        select child.id
        from public.drive_items as child
        join descendants on child.parent_id = descendants.id
        where child.user_id = old.user_id
      )
      select 1
      from descendants
      where id = new.parent_id
    ) then
      raise exception 'A folder cannot be moved inside one of its descendants';
    end if;
  end if;

  return new;
end;
$$;

create trigger drive_items_validate_parent
before insert or update of parent_id on public.drive_items
for each row execute function public.drive_validate_parent();

alter table public.drive_items enable row level security;

create policy "Users can read their own drive items"
on public.drive_items
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own drive items"
on public.drive_items
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own drive items"
on public.drive_items
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own drive items"
on public.drive_items
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.drive_items from anon;
grant select, insert, update, delete on table public.drive_items to authenticated;
grant usage, select on sequence public.drive_items_id_seq to authenticated;

create or replace function public.drive_usage()
returns table (
  used_bytes bigint,
  file_count bigint,
  folder_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum(item.size) filter (where item.kind = 'file'), 0)::bigint,
    count(*) filter (where item.kind = 'file')::bigint,
    count(*) filter (where item.kind = 'folder')::bigint
  from public.drive_items as item
  where item.user_id = (select auth.uid());
$$;

revoke all on function public.drive_usage() from public, anon;
grant execute on function public.drive_usage() to authenticated;

-- All objects live under: <auth.uid()>/<stable upload token>/<safe filename>.
-- This makes the ownership check cheap and independent of client metadata.
create policy "Users can view their own drive objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'drive'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can upload their own drive objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'drive'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can replace their own drive objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'drive'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'drive'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can delete their own drive objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'drive'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
