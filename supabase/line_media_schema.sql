alter table public.line_messages
  add column if not exists media_storage_path text,
  add column if not exists media_content_type text,
  add column if not exists media_file_name text,
  add column if not exists media_size_bytes bigint,
  add column if not exists media_status text not null default 'not_applicable',
  add column if not exists media_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'line_messages_media_status_check'
      and conrelid = 'public.line_messages'::regclass
  ) then
    alter table public.line_messages
      add constraint line_messages_media_status_check
      check (media_status in ('not_applicable', 'pending', 'saved', 'failed', 'too_large'));
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('line-message-media', 'line-message-media', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;
