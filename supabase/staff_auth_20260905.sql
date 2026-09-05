-- Unapplied migration. No accounts, passwords, invitations or external settings are
-- created here. Requires Supabase Auth and self_study_room_workflow_20260905.sql.
begin;

create table if not exists public.staff_auth_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  defaults_seeded boolean not null default false,
  absolute_seconds integer not null default 28800 check (absolute_seconds between 300 and 86400),
  idle_seconds integer not null default 1800 check (idle_seconds between 60 and 28800),
  login_window_seconds integer not null default 600 check (login_window_seconds between 60 and 3600),
  login_attempt_limit integer not null default 5 check (login_attempt_limit between 1 and 20),
  check (idle_seconds <= absolute_seconds)
);
insert into public.staff_auth_settings(singleton) values (true) on conflict do nothing;

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  staff_code text not null unique check (staff_code = btrim(staff_code) and length(staff_code) between 1 and 64),
  display_name text not null check (length(btrim(display_name)) > 0),
  role text not null check (role in ('admin', 'office', 'employee', 'teacher')),
  active boolean not null default false,
  auth_not_before timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.staff_role_permissions (
  role text not null check (role in ('admin', 'office', 'employee', 'teacher')),
  permission text not null,
  primary key (role, permission)
);
create table if not exists public.staff_permission_overrides (
  staff_id uuid not null references public.staff_accounts(id) on delete restrict,
  permission text not null,
  allowed boolean not null,
  primary key (staff_id, permission)
);
insert into public.staff_role_permissions(role,permission)
  select r, p from unnest(array['admin','office']) r,
    unnest(array['study_room.read','study_room.approve','study_room.cancel']) p
  where exists(select 1 from public.staff_auth_settings where singleton and not defaults_seeded)
  on conflict do nothing;
update public.staff_auth_settings set defaults_seeded=true where singleton and not defaults_seeded;

-- Operational state, not the audit log. Auth logout/deletion can remove it.
create table if not exists public.staff_session_activity (
  auth_session_id uuid primary key references auth.sessions(id) on delete cascade,
  staff_id uuid not null references public.staff_accounts(id) on delete restrict,
  password_stamp text not null,
  last_seen_at timestamptz not null default now()
);
create table if not exists public.staff_login_buckets (
  bucket_key text primary key,
  started_at timestamptz not null default now(),
  attempts integer not null default 0
);

-- Only a privileged server calls this, before managed Auth password verification.
-- No encrypted_password, access token or refresh token is returned or stored.
create or replace function public.staff_login_target(p_staff_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_settings public.staff_auth_settings%rowtype; v_target record; v_bucket public.staff_login_buckets%rowtype; v_key text;
begin
  select * into v_settings from public.staff_auth_settings where singleton;
  if not found or not v_settings.enabled then raise exception 'staff_auth_disabled'; end if;
  select s.id, s.auth_user_id, u.email into v_target from public.staff_accounts s
    join auth.users u on u.id = s.auth_user_id
    where s.staff_code = p_staff_code and s.active and u.email is not null
      and (u.banned_until is null or u.banned_until <= clock_timestamp());
  -- All nonexistent codes share a bounded bucket; arbitrary inputs cannot grow the table.
  v_key := case when found then v_target.id::text else 'unknown' end;
  insert into public.staff_login_buckets(bucket_key) values (v_key) on conflict do nothing;
  select * into v_bucket from public.staff_login_buckets where bucket_key = v_key for update;
  if v_bucket.started_at + make_interval(secs => v_settings.login_window_seconds) <= clock_timestamp() then
    update public.staff_login_buckets set attempts = 0, started_at = clock_timestamp() where bucket_key = v_key;
    v_bucket.attempts := 0;
  end if;
  if v_bucket.attempts >= v_settings.login_attempt_limit then return jsonb_build_object('limited', true); end if;
  update public.staff_login_buckets set attempts = attempts + 1 where bucket_key = v_key;
  if v_key = 'unknown' then return jsonb_build_object('limited', false); end if;
  return jsonb_build_object('limited', false, 'authUserId', v_target.auth_user_id, 'email', v_target.email);
end;
$$;

-- p_auth_user_id / p_auth_session_id MUST come from an access token verified by
-- Supabase Auth getUser on the server, never from request JSON or an unverified JWT.
-- Checking auth.sessions also makes revoked sessions fail before JWT expiry.
create or replace function public.staff_authorize(
  p_auth_user_id uuid, p_auth_session_id uuid, p_permission text default null, p_initialize boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_settings public.staff_auth_settings%rowtype; v_staff public.staff_accounts%rowtype;
  v_session record; v_activity public.staff_session_activity%rowtype; v_allowed boolean;
begin
  select * into v_settings from public.staff_auth_settings where singleton;
  if not found or not v_settings.enabled then raise exception 'staff_auth_disabled'; end if;
  select * into v_staff from public.staff_accounts where auth_user_id = p_auth_user_id and active for share;
  if not found then raise exception 'staff_access_denied'; end if;
  select s.created_at, s.not_after, encode(sha256(convert_to(coalesce(u.encrypted_password,''),'UTF8')),'hex') as password_stamp
    into v_session from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = p_auth_session_id and s.user_id = p_auth_user_id
      and (u.banned_until is null or u.banned_until <= clock_timestamp()) for share of s, u;
  if not found then raise exception 'staff_session_invalid'; end if;
  if v_session.created_at < v_staff.auth_not_before then raise exception 'staff_session_invalid'; end if;
  if v_session.created_at + make_interval(secs => v_settings.absolute_seconds) <= clock_timestamp()
    or (v_session.not_after is not null and v_session.not_after <= clock_timestamp()) then
    raise exception 'staff_session_expired';
  end if;
  if p_initialize then
    insert into public.staff_session_activity(auth_session_id,staff_id,password_stamp,last_seen_at)
      values (p_auth_session_id,v_staff.id,v_session.password_stamp,v_session.created_at) on conflict do nothing;
  end if;
  select * into v_activity from public.staff_session_activity where auth_session_id = p_auth_session_id for update;
  if not found or v_activity.staff_id <> v_staff.id or v_activity.password_stamp <> v_session.password_stamp then
    raise exception 'staff_session_invalid';
  end if;
  if v_activity.last_seen_at + make_interval(secs => v_settings.idle_seconds) <= clock_timestamp() then
    raise exception 'staff_session_expired';
  end if;
  if p_permission is not null then
    select allowed into v_allowed from public.staff_permission_overrides
      where staff_id = v_staff.id and permission = p_permission;
    if not found then
      select exists(select 1 from public.staff_role_permissions where role = v_staff.role and permission = p_permission) into v_allowed;
    end if;
    if not coalesce(v_allowed, false) then raise exception 'staff_permission_denied'; end if;
  end if;
  update public.staff_session_activity set last_seen_at = clock_timestamp() where auth_session_id = p_auth_session_id;
  return jsonb_build_object('staffId',v_staff.id,'staffCode',v_staff.staff_code,'displayName',v_staff.display_name,
    'role',v_staff.role,'expiresAt',v_session.created_at + make_interval(secs => v_settings.absolute_seconds));
end;
$$;

create or replace function public.staff_invalidate_old_sessions()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.active is distinct from new.active or old.auth_user_id is distinct from new.auth_user_id then
    new.auth_not_before := clock_timestamp();
  end if;
  return new;
end;
$$;
drop trigger if exists staff_invalidate_old_sessions on public.staff_accounts;
create trigger staff_invalidate_old_sessions before update on public.staff_accounts
  for each row execute function public.staff_invalidate_old_sessions();

create or replace function public.staff_study_room_transition(
  p_auth_user_id uuid, p_auth_session_id uuid, p_operation_key uuid,
  p_request_id uuid, p_expected_version integer, p_action text, p_reason text default ''
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_staff jsonb;
begin
  if p_action is null or p_action not in ('approve','reject','cancel') then raise exception 'invalid_transition'; end if;
  v_staff := public.staff_authorize(p_auth_user_id,p_auth_session_id,
    case when p_action = 'cancel' then 'study_room.cancel' else 'study_room.approve' end);
  return public.study_room_transition_request(p_operation_key,p_request_id,p_expected_version,
    p_action,'staff',v_staff->>'staffId',p_reason);
end;
$$;

alter table public.staff_auth_settings enable row level security;
alter table public.staff_accounts enable row level security;
alter table public.staff_role_permissions enable row level security;
alter table public.staff_permission_overrides enable row level security;
alter table public.staff_session_activity enable row level security;
alter table public.staff_login_buckets enable row level security;
revoke all on public.staff_auth_settings, public.staff_accounts, public.staff_role_permissions,
  public.staff_permission_overrides, public.staff_session_activity, public.staff_login_buckets from public, anon, authenticated;
revoke all on function public.staff_login_target(text), public.staff_authorize(uuid,uuid,text,boolean),
  public.staff_study_room_transition(uuid,uuid,uuid,uuid,integer,text,text), public.staff_invalidate_old_sessions() from public, anon, authenticated;
grant execute on function public.staff_login_target(text), public.staff_authorize(uuid,uuid,text,boolean),
  public.staff_study_room_transition(uuid,uuid,uuid,uuid,integer,text,text) to service_role;

commit;
