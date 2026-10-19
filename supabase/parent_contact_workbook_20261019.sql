create table if not exists public.parent_contact_log_rows(
 entry_id uuid primary key references public.post_interview_entries(id),
 drive_id text not null,item_id text not null,row_number integer not null check(row_number between 5 and 204),
 expected jsonb not null,last_written jsonb,fingerprint text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(drive_id,item_id,row_number)
);
create table if not exists public.parent_contact_workbook_lock(id boolean primary key default true check(id),lease uuid,lease_until timestamptz);
insert into public.parent_contact_workbook_lock(id) values(true) on conflict do nothing;
alter table public.parent_contact_log_rows enable row level security;
alter table public.parent_contact_workbook_lock enable row level security;
revoke all on public.parent_contact_log_rows,public.parent_contact_workbook_lock from anon,authenticated;
grant all on public.parent_contact_log_rows,public.parent_contact_workbook_lock to service_role;
create or replace function public.claim_parent_contact_workbook() returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare claimed uuid;
begin update parent_contact_workbook_lock set lease=gen_random_uuid(),lease_until=now()+interval '120 seconds' where id and (lease_until is null or lease_until<now()) returning lease into claimed;return claimed;end $$;
create or replace function public.release_parent_contact_workbook(p_lease uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin update parent_contact_workbook_lock set lease=null,lease_until=null where id and lease=p_lease;return found;end $$;
revoke all on function public.claim_parent_contact_workbook(),public.release_parent_contact_workbook(uuid) from public,anon,authenticated;
grant execute on function public.claim_parent_contact_workbook(),public.release_parent_contact_workbook(uuid) to service_role;
