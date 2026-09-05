-- Unapplied. Requires staff auth and reservation workflow. No feature is enabled.
begin;
alter table public.staff_auth_settings add column if not exists visit_defaults_seeded boolean not null default false;
insert into public.staff_role_permissions(role,permission)
  select r,'study_room.visit' from unnest(array['admin','office']) r
  where exists(select 1 from public.staff_auth_settings where singleton and not visit_defaults_seeded)
  on conflict do nothing;
update public.staff_auth_settings set visit_defaults_seeded=true where singleton and not visit_defaults_seeded;

create table if not exists public.study_room_visits (
  request_id uuid primary key references public.study_room_requests(id) on delete restrict,
  version integer not null check(version>0),
  started_at timestamptz, ended_at timestamptz,
  destination text check(destination in ('lesson','home','other')),
  confirmed_by uuid not null references public.staff_accounts(id) on delete restrict,
  confirmed_at timestamptz not null,
  check(ended_at is null or (started_at is not null and ended_at>=started_at)),
  check((ended_at is null)=(destination is null))
);
create table if not exists public.study_room_visit_events (
  operation_key uuid primary key,
  request_id uuid not null references public.study_room_requests(id) on delete restrict,
  version integer not null,
  staff_id uuid not null references public.staff_accounts(id) on delete restrict,
  reason text not null,
  payload jsonb not null,
  before_state jsonb,
  after_state jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(request_id,version)
);
alter table public.study_room_visits enable row level security;
alter table public.study_room_visit_events enable row level security;
revoke all on public.study_room_visits,public.study_room_visit_events from public,anon,authenticated,service_role;

create or replace function public.staff_study_room_save_visit(
  p_auth_user_id uuid,p_auth_session_id uuid,p_operation_key uuid,p_request_id uuid,
  p_expected_version integer,p_started_at timestamptz,p_ended_at timestamptz,
  p_destination text,p_reason text default ''
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_staff jsonb; v_request public.study_room_requests%rowtype; v_before jsonb;
  v_after jsonb; v_payload jsonb; v_event public.study_room_visit_events%rowtype; v_version integer;
begin
  v_staff:=public.staff_authorize(p_auth_user_id,p_auth_session_id,'study_room.visit');
  if not exists(select 1 from public.study_room_workflow_settings where singleton and enabled) then raise exception 'workflow_disabled'; end if;
  if p_operation_key is null or p_request_id is null or p_expected_version is null or p_expected_version<0
    or p_reason is null or length(p_reason)>2000 then raise exception 'invalid_request'; end if;
  v_payload:=jsonb_build_object('requestId',p_request_id,'expectedVersion',p_expected_version,
    'startedAt',p_started_at,'endedAt',p_ended_at,'destination',p_destination,'reason',btrim(p_reason),'staffId',v_staff->>'staffId');
  perform pg_advisory_xact_lock(hashtextextended('study-room-visit/'||p_operation_key::text,0));
  select * into v_event from public.study_room_visit_events where operation_key=p_operation_key;
  if found then
    if v_event.payload<>v_payload then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('visit',v_event.after_state,'replayed',true);
  end if;
  select * into v_request from public.study_room_requests where id=p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  select to_jsonb(v),v.version into v_before,v_version from public.study_room_visits v where request_id=p_request_id;
  v_version:=coalesce(v_version,0);
  if v_version<>p_expected_version then raise exception 'version_conflict'; end if;
  -- Existing facts may still need correcting after a reservation was cancelled.
  if v_request.status<>'approved' and not(v_request.status='cancelled' and v_version>0) then raise exception 'invalid_state_transition'; end if;
  if v_version>0 and btrim(p_reason)='' and not coalesce(
    p_started_at=(v_before->>'started_at')::timestamptz and v_before->>'ended_at' is null
      and p_ended_at is not null,false) then raise exception 'reason_required'; end if;
  if v_version=0 and p_started_at is null then raise exception 'invalid_visit_time'; end if;
  if (p_started_at is not null and (not isfinite(p_started_at) or p_started_at>clock_timestamp()
      or (p_started_at at time zone 'Asia/Tokyo')::date<>v_request.reservation_date))
    or (p_ended_at is not null and (p_started_at is null or not isfinite(p_ended_at)
      or p_ended_at<p_started_at or p_ended_at>clock_timestamp()
      or (p_ended_at at time zone 'Asia/Tokyo')::date<>v_request.reservation_date))
    or ((p_ended_at is null)<>(p_destination is null))
    or (p_destination is not null and p_destination not in ('lesson','home','other')) then raise exception 'invalid_visit_time'; end if;
  insert into public.study_room_visits(request_id,version,started_at,ended_at,destination,confirmed_by,confirmed_at)
    values(p_request_id,v_version+1,p_started_at,p_ended_at,p_destination,(v_staff->>'staffId')::uuid,clock_timestamp())
    on conflict(request_id) do update set version=excluded.version,started_at=excluded.started_at,
      ended_at=excluded.ended_at,destination=excluded.destination,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at;
  select to_jsonb(v) into v_after from public.study_room_visits v where request_id=p_request_id;
  insert into public.study_room_visit_events(operation_key,request_id,version,staff_id,reason,payload,before_state,after_state)
    values(p_operation_key,p_request_id,v_version+1,(v_staff->>'staffId')::uuid,btrim(p_reason),v_payload,v_before,v_after);
  -- Never release seat inventory, mark lesson attendance or enqueue home notifications.
  return jsonb_build_object('visit',v_after,'replayed',false);
end;
$$;
revoke all on function public.staff_study_room_save_visit(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.staff_study_room_save_visit(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,text) to service_role;
commit;
