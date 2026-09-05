-- Unapplied. Requires staff_auth_20260905.sql. No feature is enabled here.
begin;
create or replace function public.staff_study_room_requests(
  p_auth_user_id uuid, p_auth_session_id uuid, p_date date,
  p_status text default null, p_offset integer default 0
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_staff jsonb; v_rows jsonb; v_permissions jsonb;
begin
  v_staff := public.staff_authorize(p_auth_user_id,p_auth_session_id,'study_room.read');
  if not exists(select 1 from public.study_room_workflow_settings where singleton and enabled) then
    raise exception 'workflow_disabled';
  end if;
  if p_date is null or p_offset is null or p_offset < 0
    or (p_status is not null and p_status not in ('pending','approved','rejected','cancelled')) then
    raise exception 'invalid_request';
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]'::jsonb) into v_rows from (
    select r.id,r.student_number,s.student_name,s.grade,r.reservation_date,r.seat,r.slot_ids,
      r.status,r.version,r.request_kind,r.intake_channel,r.created_at,r.updated_at
    from public.study_room_requests r join public.student_roster s on s.student_number=r.student_number
    where r.reservation_date=p_date and (p_status is null or r.status=p_status)
    order by r.created_at desc,r.id limit 51 offset p_offset
  ) q;
  select jsonb_object_agg(p,coalesce(
    (select allowed from public.staff_permission_overrides where staff_id=(v_staff->>'staffId')::uuid and permission=p),
    exists(select 1 from public.staff_role_permissions where role=v_staff->>'role' and permission=p)))
    into v_permissions from unnest(array['study_room.approve','study_room.cancel','study_room.submit']) p;
  return jsonb_build_object('requests',case when jsonb_array_length(v_rows)>50 then v_rows - 50 else v_rows end,
    'hasMore',jsonb_array_length(v_rows)>50,'permissions',v_permissions);
end;
$$;
revoke all on function public.staff_study_room_requests(uuid,uuid,date,text,integer) from public,anon,authenticated;
grant execute on function public.staff_study_room_requests(uuid,uuid,date,text,integer) to service_role;
commit;
