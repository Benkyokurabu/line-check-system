-- Unapplied. Requires staff_study_room_visits_20260905.sql. Enables nothing.
begin;
create or replace function public.staff_study_room_visit_history(
  p_auth_user_id uuid,p_auth_session_id uuid,p_request_id uuid,p_before_version integer default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_rows jsonb;
begin
  perform public.staff_authorize(p_auth_user_id,p_auth_session_id,'study_room.read');
  if not exists(select 1 from public.study_room_workflow_settings where singleton and enabled) then raise exception 'workflow_disabled'; end if;
  if p_request_id is null or (p_before_version is not null and p_before_version<1) then raise exception 'invalid_request'; end if;
  if not exists(select 1 from public.study_room_requests where id=p_request_id) then raise exception 'request_not_found'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.version desc),'[]'::jsonb) into v_rows from (
    select e.version,e.reason,e.recorded_at,a.display_name as staff_name,a.staff_code,
      case when e.before_state is null then null else jsonb_build_object(
        'started_at',e.before_state->'started_at','ended_at',e.before_state->'ended_at','destination',e.before_state->'destination') end as before_state,
      jsonb_build_object('started_at',e.after_state->'started_at','ended_at',e.after_state->'ended_at','destination',e.after_state->'destination') as after_state
    from public.study_room_visit_events e join public.staff_accounts a on a.id=e.staff_id
    where e.request_id=p_request_id and (p_before_version is null or e.version<p_before_version)
    order by e.version desc limit 21
  ) q;
  return jsonb_build_object('events',case when jsonb_array_length(v_rows)>20 then v_rows-20 else v_rows end,'hasMore',jsonb_array_length(v_rows)>20);
end;
$$;
revoke all on function public.staff_study_room_visit_history(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.staff_study_room_visit_history(uuid,uuid,uuid,integer) to service_role;
commit;
