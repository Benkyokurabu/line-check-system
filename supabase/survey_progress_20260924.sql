alter table public.survey_confirmations add column if not exists progress_status text;
do $$ begin
 alter table public.survey_confirmations add constraint survey_confirmations_progress_status_check
  check(progress_status in ('needs-review','handled','coordinating','scheduled','completed'));
exception when duplicate_object then null; end $$;

create or replace function public.save_shared_survey_confirmations(p_changes jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; prior survey_confirmations%rowtype; selected_progress text;
begin
 if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 200 then raise exception 'invalid_request'; end if;
 perform pg_advisory_xact_lock(2026091602);
 for item in select value from jsonb_array_elements(p_changes) loop
  selected_progress:=coalesce(item->>'progress',case when jsonb_typeof(item->'confirmed')='boolean' then case when (item->>'confirmed')::boolean then 'handled' else 'needs-review' end end);
  if (item->>'pageId') is null or (item->>'pageId') !~ '^[a-f0-9]{32}$'
   or selected_progress not in ('needs-review','handled','coordinating','scheduled','completed')
   or (item->>'version') is null or (item->>'version') !~ '^[0-9]+$' then raise exception 'invalid_request'; end if;
  select * into prior from survey_confirmations where page_id=item->>'pageId';
  if found and prior.progress_status=selected_progress then continue; end if;
  if coalesce(prior.version,0)<>(item->>'version')::integer then raise exception 'survey_conflict'; end if;
  insert into survey_confirmations(page_id,confirmed,progress_status,updated_by) values(item->>'pageId',selected_progress<>'needs-review',selected_progress,null)
   on conflict(page_id) do update set confirmed=excluded.confirmed,progress_status=excluded.progress_status,version=survey_confirmations.version+1,updated_by=null,updated_at=now();
 end loop;
end; $$;
revoke all on function public.save_shared_survey_confirmations(jsonb) from public,anon,authenticated;
grant execute on function public.save_shared_survey_confirmations(jsonb) to service_role;

create or replace function public.save_survey_confirmations(p_staff_id uuid,p_changes jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; prior survey_confirmations%rowtype; selected_progress text;
begin
 if not exists(select 1 from staff_accounts where id=p_staff_id and active) then raise exception 'staff_permission_denied'; end if;
 if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 200 then raise exception 'invalid_request'; end if;
 perform pg_advisory_xact_lock(2026091602);
 for item in select value from jsonb_array_elements(p_changes) loop
  selected_progress:=coalesce(item->>'progress',case when jsonb_typeof(item->'confirmed')='boolean' then case when (item->>'confirmed')::boolean then 'handled' else 'needs-review' end end);
  if (item->>'pageId') is null or (item->>'pageId') !~ '^[a-f0-9]{32}$'
   or selected_progress not in ('needs-review','handled','coordinating','scheduled','completed')
   or (item->>'version') is null or (item->>'version') !~ '^[0-9]+$' then raise exception 'invalid_request'; end if;
  select * into prior from survey_confirmations where page_id=item->>'pageId';
  if found and prior.progress_status=selected_progress then continue; end if;
  if coalesce(prior.version,0)<>(item->>'version')::integer then raise exception 'survey_conflict'; end if;
  insert into survey_confirmations(page_id,confirmed,progress_status,updated_by) values(item->>'pageId',selected_progress<>'needs-review',selected_progress,p_staff_id)
   on conflict(page_id) do update set confirmed=excluded.confirmed,progress_status=excluded.progress_status,version=survey_confirmations.version+1,updated_by=excluded.updated_by,updated_at=now();
 end loop;
end; $$;
revoke all on function public.save_survey_confirmations(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_survey_confirmations(uuid,jsonb) to service_role;
