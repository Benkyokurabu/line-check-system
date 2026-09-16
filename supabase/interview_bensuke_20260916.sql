begin;
alter table public.interview_bookings add column if not exists notion_original jsonb;
alter table public.interview_bookings add column if not exists notion_baseline jsonb;
alter table public.interview_bookings add column if not exists notion_expected jsonb;

create or replace function public.interview_bensuke_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' or new.data is distinct from old.data or new.status is distinct from old.status then
  if exists(select 1 from interview_bookings where sync_lease_until>clock_timestamp() and id<>new.id) then raise exception 'version_conflict'; end if;
  if tg_op='UPDATE' and old.notion_expected is not null then raise exception 'notion_sync_unresolved'; end if;
 end if;
 if tg_op='INSERT' and new.data ? 'bensuke' then
  if new.data->'bensuke'->>'sourceId'<>'19ef0120-80a7-80c4-a965-000b104ea319'
   or jsonb_typeof(new.data->'bensuke'->'baseline') is distinct from 'object'
   or new.data->'bensuke'->>'pageId' is null then raise exception 'invalid_bensuke_binding'; end if;
  new.notion_page_id:=(new.data->'bensuke'->>'pageId')::uuid;
  new.notion_edited_at:=(new.data->'bensuke'->>'editedAt')::timestamptz;
  new.notion_original:=new.data->'bensuke'->'baseline';
  new.notion_baseline:=new.notion_original;
 elsif tg_op='UPDATE' and new.data->'bensuke' is distinct from old.data->'bensuke' then
  raise exception 'bensuke_binding_immutable';
 end if;
 return new;
end;$$;
drop trigger if exists interview_bensuke_guard on public.interview_bookings;
create trigger interview_bensuke_guard before insert or update on public.interview_bookings for each row execute function public.interview_bensuke_guard();

create or replace function public.interview_sync_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b interview_bookings%rowtype; lease uuid:=gen_random_uuid();
begin
 perform 1 from interview_settings where id for update;
 select * into b from interview_bookings where id=p_id for update;
 if not found or b.status='pending' or b.notion_synced_version=b.version or b.notion_page_id is null
  or b.notion_original is null or exists(select 1 from interview_bookings where sync_lease_until>clock_timestamp()) then return null; end if;
 update interview_bookings set sync_lease=lease,sync_lease_until=clock_timestamp()+interval '3 minutes' where id=p_id;
 return to_jsonb(b)||jsonb_build_object('lease',lease);
end;$$;

create or replace function public.interview_bensuke_stage(p_id uuid,p_lease uuid,p_expected jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from interview_settings where id for update;
 update interview_bookings set notion_expected=p_expected,sync_lease_until=clock_timestamp()+interval '3 minutes' where id=p_id and sync_lease=p_lease and sync_lease_until>clock_timestamp();
 if not found then raise exception 'version_conflict'; end if;
end;$$;

create or replace function public.interview_sync_finish(p_id uuid,p_lease uuid,p_result jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from interview_settings where id for update;
 update interview_bookings set
  notion_page_id=case when p_result->>'status'='synced' and status in ('cancelled','rejected') then null else notion_page_id end,
  notion_edited_at=case when p_result->>'status'='synced' then (p_result->>'editedAt')::timestamptz else notion_edited_at end,
  notion_baseline=case when p_result->>'status'='synced' then p_result->'value' else notion_baseline end,
  notion_expected=case when p_result->>'status'='synced' then null else notion_expected end,
  notion_synced_version=case when p_result->>'status'='synced' then version else notion_synced_version end,
  sync_error=case when p_result->>'status'='synced' then null else p_result->>'message' end,
  sync_lease=null,sync_lease_until=null where id=p_id and sync_lease=p_lease and sync_lease_until>clock_timestamp();
 if not found then raise exception 'version_conflict'; end if;
end;$$;

create or replace function public.interview_bensuke_adopt(
 p_auth_user_id uuid,p_auth_session_id uuid,p_operation_key uuid,p_snapshot text,p_id uuid,p_version integer,
 p_data jsonb,p_reason text,p_request_hash text,p_remote jsonb,p_edited_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b interview_bookings%rowtype; result jsonb; event interview_events%rowtype; s jsonb;
begin
 s:=staff_authorize(p_auth_user_id,p_auth_session_id,null,false);
 perform 1 from interview_settings where id for update;
 select * into event from interview_events where operation_key=p_operation_key;
 if found then
  if event.actor<>(s->>'staffId')::uuid or event.request_hash<>p_request_hash then raise exception 'idempotency_conflict'; end if;
  return event.after_value;
 end if;
 select * into b from interview_bookings where id=p_id for update;
 if not found or b.status<>'confirmed' or b.notion_original is null or b.notion_page_id is null
  or b.notion_expected is not null or b.notion_synced_version<>b.version then raise exception 'notion_local_unsynced'; end if;
 result:=interview_save(p_auth_user_id,p_auth_session_id,p_operation_key,p_snapshot,'update',p_id,p_version,p_data,p_reason,p_request_hash);
 update interview_bookings set notion_baseline=p_remote,notion_edited_at=p_edited_at,notion_synced_version=version,sync_error=null
  where id=p_id returning to_jsonb(interview_bookings.*) into result;
 update interview_events set after_value=result where operation_key=p_operation_key;
 return result;
end;$$;
revoke all on function public.interview_bensuke_guard(),public.interview_bensuke_stage(uuid,uuid,jsonb),public.interview_bensuke_adopt(uuid,uuid,uuid,text,uuid,integer,jsonb,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.interview_bensuke_stage(uuid,uuid,jsonb),public.interview_bensuke_adopt(uuid,uuid,uuid,text,uuid,integer,jsonb,text,text,jsonb,timestamptz) to service_role;
update public.interview_settings set notion_source_id='19ef0120-80a7-80c4-a965-000b104ea319',notion_status='ベンスケの予約可から登録した予定を連携',version=version+1 where id;
commit;
