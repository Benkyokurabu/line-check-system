create table if not exists public.survey_confirmations (
 page_id text primary key check(page_id ~ '^[a-f0-9]{32}$'),
 confirmed boolean not null,
 version integer not null default 1 check(version>0),
 updated_by uuid not null references public.staff_accounts(id),
 updated_at timestamptz not null default now()
);
alter table public.survey_confirmations enable row level security;
revoke all on public.survey_confirmations from public,anon,authenticated;
grant all on public.survey_confirmations to service_role;
create or replace function public.save_survey_confirmations(p_staff_id uuid,p_changes jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; prior survey_confirmations%rowtype;
begin
 if not exists(select 1 from staff_accounts where id=p_staff_id and active) then raise exception 'staff_permission_denied'; end if;
 if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 200 then raise exception 'invalid_request'; end if;
 perform pg_advisory_xact_lock(2026091602);
 for item in select value from jsonb_array_elements(p_changes) loop
  if (item->>'pageId') !~ '^[a-f0-9]{32}$' or item->>'pageId' is null
   or jsonb_typeof(item->'confirmed') is distinct from 'boolean'
   or (item->>'version') !~ '^[0-9]+$' or item->>'version' is null then raise exception 'invalid_request'; end if;
  select * into prior from survey_confirmations where page_id=item->>'pageId';
  if found and prior.confirmed=(item->>'confirmed')::boolean then continue; end if;
  if coalesce(prior.version,0)<>(item->>'version')::integer then raise exception 'survey_conflict'; end if;
  insert into survey_confirmations(page_id,confirmed,updated_by) values(item->>'pageId',(item->>'confirmed')::boolean,p_staff_id)
   on conflict(page_id) do update set confirmed=excluded.confirmed,version=survey_confirmations.version+1,updated_by=excluded.updated_by,updated_at=now();
 end loop;
end; $$;
revoke all on function public.save_survey_confirmations(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_survey_confirmations(uuid,jsonb) to service_role;
