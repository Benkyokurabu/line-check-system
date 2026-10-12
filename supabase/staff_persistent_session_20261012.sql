-- Keep managed revocation, account/password checks, permissions and same-origin protection.
-- The rolling cookie horizon is renewed on use; no application idle/absolute logout.
begin;
alter table public.staff_auth_settings add column if not exists persist_until_logout boolean not null default false;
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
  if (not v_settings.persist_until_logout and v_session.created_at + make_interval(secs => v_settings.absolute_seconds) <= clock_timestamp())
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
  if not v_settings.persist_until_logout and v_activity.last_seen_at + make_interval(secs => v_settings.idle_seconds) <= clock_timestamp() then
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
    'role',v_staff.role,'expiresAt',least(v_session.not_after,case when v_settings.persist_until_logout then clock_timestamp() + interval '365 days' else v_session.created_at + make_interval(secs => v_settings.absolute_seconds) end));
end;
$$;
commit;
