-- Not applied automatically. Enable only after authenticated routes replace legacy
-- writers and the production migration/cutover is explicitly approved.
-- Prerequisites: self_study_room_schema.sql and LINE verification schema.
-- Requests are intentions; study_room_reservations remains the ONLY seat inventory.
begin;

create table if not exists public.study_room_workflow_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into public.study_room_workflow_settings(singleton) values (true) on conflict do nothing;

create table if not exists public.study_room_requests (
  id uuid primary key default gen_random_uuid(),
  student_number text not null references public.student_roster(student_number) on delete restrict,
  reservation_date date not null,
  seat smallint not null check (seat between 1 and 10),
  slot_ids text[] not null check (cardinality(slot_ids) between 1 and 4),
  actor_kind text not null check (actor_kind in ('student', 'guardian', 'staff')),
  actor_id text not null check (length(btrim(actor_id)) > 0),
  relation_snapshot text,
  intake_channel text not null check (intake_channel in ('line_screen', 'line_message', 'staff')),
  request_kind text not null check (request_kind in ('advance', 'same_day')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  constraint study_room_request_approval_pair check ((approved_by is null) = (approved_at is null)),
  constraint study_room_request_approval_required check (status <> 'approved' or approved_at is not null)
);
create index if not exists study_room_requests_day_status_idx
  on public.study_room_requests(reservation_date, status);

alter table public.study_room_reservations add column if not exists request_id uuid
  references public.study_room_requests(id) on delete restrict;
create index if not exists study_room_reservations_request_idx
  on public.study_room_reservations(request_id);

create table if not exists public.study_room_request_events (
  id uuid primary key default gen_random_uuid(),
  operation_key uuid not null unique,
  request_id uuid not null references public.study_room_requests(id) on delete restrict,
  version integer not null,
  action text not null check (action in ('submit', 'approve', 'reject', 'cancel')),
  actor_kind text not null check (actor_kind in ('student', 'guardian', 'staff')),
  actor_id text not null,
  reason text not null default '',
  payload jsonb not null,
  from_status text,
  to_status text not null,
  created_at timestamptz not null default now(),
  unique (request_id, version)
);

-- Durable notification intent only. No recipient guessing or sending in this migration.
create table if not exists public.study_room_notification_intents (
  event_id uuid primary key references public.study_room_request_events(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'unknown', 'skipped')),
  created_at timestamptz not null default now()
);

-- These functions are service-role-only building blocks, NOT authentication.
-- A server-verified LINE identity or individually authenticated staff identity and
-- operation permission must be established before invoking them.
create or replace function public.study_room_assert_actor(
  p_student_number text, p_actor_kind text, p_actor_id text
) returns text language plpgsql set search_path = public, pg_temp as $$
declare v_relation text;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' or p_actor_kind is null
    or p_actor_kind not in ('student', 'guardian', 'staff') then
    raise exception 'identity_required';
  end if;
  if p_actor_kind = 'staff' then return null; end if;
  select relation into v_relation from public.student_line_accounts
    where student_number = p_student_number and line_user_id = p_actor_id
      and verification_status = 'confirmed';
  if (p_actor_kind = 'student' and v_relation = 'student')
    or (p_actor_kind = 'guardian' and v_relation in ('mother', 'father', 'guardian')) then
    return v_relation;
  end if;
  raise exception 'subject_not_authorized';
end;
$$;

create or replace function public.study_room_assert_capacity(
  p_student_number text, p_date date, p_seat integer, p_slot_ids text[]
) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_setting public.study_room_day_settings%rowtype; v_minutes integer;
begin
  -- Caller holds the date lock. Use server/Japan date; never trust a client clock.
  if p_date < (clock_timestamp() at time zone 'Asia/Tokyo')::date then
    raise exception 'past_date';
  end if;
  select * into v_setting from public.study_room_day_settings where reservation_date = p_date;
  if found and jsonb_typeof(v_setting.closed_slot_ids) is distinct from 'array' then
    raise exception 'invalid_day_settings';
  end if;
  if exists (select 1 from unnest(p_slot_ids) s where v_setting.closed_slot_ids ? s) then
    raise exception 'slot_closed';
  end if;
  if exists (select 1 from public.study_room_reservations
    where reservation_date = p_date and status = 'active' and slot_id = any(p_slot_ids) and seat = p_seat) then
    raise exception 'seat_unavailable';
  end if;
  if exists (select 1 from public.study_room_reservations
    where reservation_date = p_date and status = 'active' and slot_id = any(p_slot_ids) and student_number = p_student_number) then
    raise exception 'student_slot_conflict';
  end if;
  select coalesce(sum(minutes), 0) into v_minutes from public.study_room_reservations
    where reservation_date = p_date and status = 'active' and student_number = p_student_number;
  if coalesce(v_setting.limit_minutes, 0) > 0
    and v_minutes + cardinality(p_slot_ids) * 90 > v_setting.limit_minutes then
    raise exception 'daily_limit_exceeded';
  end if;
end;
$$;

create or replace function public.study_room_submit_request(
  p_operation_key uuid, p_student_number text, p_date date, p_seat integer,
  p_slot_ids text[], p_actor_kind text, p_actor_id text, p_channel text
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_slots text[]; v_payload jsonb; v_event public.study_room_request_events%rowtype;
  v_request public.study_room_requests%rowtype; v_relation text;
begin
  if not coalesce((select enabled from public.study_room_workflow_settings where singleton), false) then
    raise exception 'workflow_disabled';
  end if;
  if p_operation_key is null or p_student_number is null or btrim(p_student_number) = ''
    or p_date is null or p_seat is null or p_seat not between 1 and 10
    or p_slot_ids is null or cardinality(p_slot_ids) not between 1 and 4
    or exists (select 1 from unnest(p_slot_ids) s where s is null or s not in
      ('14:55-16:25', '16:45-18:15', '18:35-20:05', '20:25-21:55'))
    or p_channel is null or p_channel not in ('line_screen', 'line_message', 'staff')
    or ((p_actor_kind = 'staff') <> (p_channel = 'staff')) then
    raise exception 'invalid_request';
  end if;
  select array_agg(distinct s order by s) into v_slots from unnest(p_slot_ids) s;
  v_relation := public.study_room_assert_actor(p_student_number, p_actor_kind, p_actor_id);
  v_payload := jsonb_build_object('student', p_student_number, 'date', p_date, 'seat', p_seat,
    'slots', v_slots, 'actorKind', p_actor_kind, 'actorId', p_actor_id, 'channel', p_channel);
  -- Stable lock ordering: operation key, then date. A retry cannot create another request.
  perform pg_advisory_xact_lock(hashtextextended('study-room-operation/' || p_operation_key::text, 0));
  select * into v_event from public.study_room_request_events where operation_key = p_operation_key;
  if found then
    if v_event.action <> 'submit' or v_event.payload <> v_payload then raise exception 'idempotency_conflict'; end if;
    select * into v_request from public.study_room_requests where id = v_event.request_id;
    return jsonb_build_object('request', to_jsonb(v_request), 'replayed', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('study-room-day/' || to_char(p_date, 'YYYY-MM-DD'), 0));
  perform public.study_room_assert_capacity(p_student_number, p_date, p_seat, v_slots);
  if exists (select 1 from public.study_room_requests where student_number = p_student_number
    and reservation_date = p_date and status = 'pending' and slot_ids && v_slots) then
    raise exception 'pending_student_slot_conflict';
  end if;
  insert into public.study_room_requests(student_number, reservation_date, seat, slot_ids,
    actor_kind, actor_id, relation_snapshot, intake_channel, request_kind)
  values (p_student_number, p_date, p_seat, v_slots, p_actor_kind, p_actor_id, v_relation,
    p_channel, case when p_date = (clock_timestamp() at time zone 'Asia/Tokyo')::date then 'same_day' else 'advance' end)
  returning * into v_request;
  insert into public.study_room_request_events(operation_key, request_id, version, action,
    actor_kind, actor_id, payload, to_status)
  values (p_operation_key, v_request.id, 1, 'submit', p_actor_kind, p_actor_id, v_payload, 'pending');
  return jsonb_build_object('request', to_jsonb(v_request), 'replayed', false);
end;
$$;

create or replace function public.study_room_transition_request(
  p_operation_key uuid, p_request_id uuid, p_expected_version integer,
  p_action text, p_actor_kind text, p_actor_id text, p_reason text default ''
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_request public.study_room_requests%rowtype; v_event public.study_room_request_events%rowtype;
  v_payload jsonb; v_old_status text; v_new_status text; v_student public.student_roster%rowtype;
begin
  if not coalesce((select enabled from public.study_room_workflow_settings where singleton), false) then
    raise exception 'workflow_disabled';
  end if;
  if p_operation_key is null or p_request_id is null or p_expected_version is null
    or p_expected_version < 1 or p_action is null or p_action not in ('approve', 'reject', 'cancel') then
    raise exception 'invalid_transition';
  end if;
  if p_action in ('approve', 'reject') and p_actor_kind is distinct from 'staff' then
    raise exception 'staff_permission_required';
  end if;
  if p_action = 'reject' and btrim(coalesce(p_reason, '')) = '' then raise exception 'reason_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('study-room-operation/' || p_operation_key::text, 0));
  select * into v_request from public.study_room_requests where id = p_request_id;
  if not found then raise exception 'request_not_found'; end if;
  perform public.study_room_assert_actor(v_request.student_number, p_actor_kind, p_actor_id);
  v_payload := jsonb_build_object('requestId', p_request_id, 'expectedVersion', p_expected_version,
    'action', p_action, 'actorKind', p_actor_kind, 'actorId', p_actor_id, 'reason', coalesce(p_reason, ''));
  select * into v_event from public.study_room_request_events where operation_key = p_operation_key;
  if found then
    if v_event.payload <> v_payload or v_event.action <> p_action then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('request', to_jsonb(v_request), 'replayed', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('study-room-day/' || to_char(v_request.reservation_date, 'YYYY-MM-DD'), 0));
  select * into v_request from public.study_room_requests where id = p_request_id for update;
  if v_request.version <> p_expected_version then raise exception 'version_conflict'; end if;
  if (p_action in ('approve', 'reject') and v_request.status <> 'pending')
    or (p_action = 'cancel' and v_request.status not in ('pending', 'approved')) then
    raise exception 'invalid_state_transition';
  end if;
  v_old_status := v_request.status;
  v_new_status := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'cancelled' end;
  perform set_config('app.study_room_request_write', p_request_id::text, true);
  if p_action = 'approve' then
    perform public.study_room_assert_capacity(v_request.student_number, v_request.reservation_date,
      v_request.seat, v_request.slot_ids);
    select * into strict v_student from public.student_roster where student_number = v_request.student_number;
    insert into public.study_room_reservations(reservation_date, slot_id, start_time, end_time,
      seat, student_number, grade, student_name, minutes, status, request_id)
    select v_request.reservation_date, s, split_part(s, '-', 1), split_part(s, '-', 2),
      v_request.seat, v_student.student_number, v_student.grade, v_student.student_name, 90, 'active', v_request.id
      from unnest(v_request.slot_ids) s;
  elsif p_action = 'cancel' then
    update public.study_room_reservations set status = 'cancelled', cancelled_at = now()
      where request_id = p_request_id and status = 'active';
  end if;
  update public.study_room_requests set status = v_new_status, version = version + 1, updated_at = now(),
    approved_by = case when p_action = 'approve' then p_actor_id else approved_by end,
    approved_at = case when p_action = 'approve' then now() else approved_at end
    where id = p_request_id returning * into v_request;
  insert into public.study_room_request_events(operation_key, request_id, version, action,
    actor_kind, actor_id, reason, payload, from_status, to_status)
  values (p_operation_key, p_request_id, v_request.version, p_action, p_actor_kind, p_actor_id,
    coalesce(p_reason, ''), v_payload, v_old_status, v_new_status) returning * into v_event;
  if p_action in ('approve', 'cancel', 'reject') then
    insert into public.study_room_notification_intents(event_id) values (v_event.id);
  end if;
  return jsonb_build_object('request', to_jsonb(v_request), 'replayed', false);
end;
$$;

-- Cutover must not leave the old unauthenticated insert/cancel endpoints able to
-- bypass approvals or change a workflow-owned row without its request history.
create or replace function public.study_room_guard_inventory_write()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_request_id uuid;
begin
  if tg_op = 'DELETE' then raise exception 'reservation_history_must_be_preserved'; end if;
  v_request_id := new.request_id;
  if tg_op = 'UPDATE' and old.request_id is not null and old.request_id is distinct from new.request_id then
    raise exception 'request_link_is_immutable';
  end if;
  if v_request_id is not null or coalesce((select enabled from public.study_room_workflow_settings where singleton), false) then
    if v_request_id is null or current_setting('app.study_room_request_write', true) is distinct from v_request_id::text then
      raise exception 'workflow_write_required';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists study_room_inventory_workflow_guard on public.study_room_reservations;
create trigger study_room_inventory_workflow_guard before insert or update or delete on public.study_room_reservations
  for each row execute function public.study_room_guard_inventory_write();

-- All settings writers, including the old admin endpoint, share the approval lock.
create or replace function public.study_room_lock_day_setting()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.reservation_date <> old.reservation_date then
    raise exception 'setting_date_is_immutable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('study-room-day/' ||
    to_char(case when tg_op = 'DELETE' then old.reservation_date else new.reservation_date end, 'YYYY-MM-DD'), 0));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists study_room_setting_day_lock on public.study_room_day_settings;
create trigger study_room_setting_day_lock before insert or update or delete on public.study_room_day_settings
  for each row execute function public.study_room_lock_day_setting();

alter table public.study_room_workflow_settings enable row level security;
alter table public.study_room_requests enable row level security;
alter table public.study_room_request_events enable row level security;
alter table public.study_room_notification_intents enable row level security;
alter table public.study_room_reservations enable row level security;
alter table public.study_room_day_settings enable row level security;
revoke all on public.study_room_reservations, public.study_room_day_settings from public, anon, authenticated, service_role;
grant select, insert, update on public.study_room_reservations to service_role;
grant select, insert, update, delete on public.study_room_day_settings to service_role;
revoke all on public.study_room_workflow_settings, public.study_room_requests,
  public.study_room_request_events, public.study_room_notification_intents from public, anon, authenticated, service_role;
grant select, insert, update on public.study_room_workflow_settings, public.study_room_requests,
  public.study_room_notification_intents to service_role;
grant select, insert on public.study_room_request_events to service_role;
revoke all on function public.study_room_assert_actor(text,text,text),
  public.study_room_assert_capacity(text,date,integer,text[]),
  public.study_room_submit_request(uuid,text,date,integer,text[],text,text,text),
  public.study_room_transition_request(uuid,uuid,integer,text,text,text,text),
  public.study_room_lock_day_setting(), public.study_room_guard_inventory_write() from public, anon, authenticated;
grant execute on function public.study_room_assert_actor(text,text,text),
  public.study_room_assert_capacity(text,date,integer,text[]),
  public.study_room_submit_request(uuid,text,date,integer,text[],text,text,text),
  public.study_room_transition_request(uuid,uuid,integer,text,text,text,text) to service_role;

commit;
