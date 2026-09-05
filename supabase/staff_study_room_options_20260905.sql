-- Unapplied. Requires staff_study_room_intake_20260905.sql.
begin;
create or replace function public.staff_study_room_intake_options(
  p_auth_user_id uuid,p_auth_session_id uuid,p_date date,p_query text default '',p_student_number text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_matches jsonb; v_student jsonb; v_setting public.study_room_day_settings%rowtype;
  v_booked jsonb; v_minutes integer; v_pending jsonb; v_query text; v_student_slots jsonb;
begin
  perform public.staff_authorize(p_auth_user_id,p_auth_session_id,'study_room.submit');
  if not exists(select 1 from public.study_room_workflow_settings where singleton and enabled) then raise exception 'workflow_disabled'; end if;
  if p_date is null or p_query is null or length(p_query)>64
    or (p_student_number is not null and length(btrim(p_student_number)) not between 1 and 64) then raise exception 'invalid_request'; end if;
  v_query := regexp_replace(p_query,'[[:space:]　]','','g');
  select coalesce(jsonb_agg(to_jsonb(q) order by q.student_number),'[]'::jsonb) into v_matches from (
    select student_number,student_name,grade,campus from public.student_roster
    where v_query<>'' and (strpos(regexp_replace(student_name,'[[:space:]　]','','g'),v_query)>0 or student_number=p_query)
    order by student_number limit 21
  ) q;
  select jsonb_build_object('student_number',student_number,'student_name',student_name,'grade',grade,'campus',campus)
    into v_student from public.student_roster where student_number=p_student_number;
  if p_student_number is not null and v_student is null then raise exception 'student_not_found'; end if;
  select * into v_setting from public.study_room_day_settings where reservation_date=p_date;
  if found and jsonb_typeof(v_setting.closed_slot_ids) is distinct from 'array' then raise exception 'invalid_day_settings'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('seat',seat,'slotId',slot_id)),'[]'::jsonb),
    coalesce(sum(minutes) filter(where student_number=p_student_number),0),
    coalesce(jsonb_agg(distinct slot_id) filter(where student_number=p_student_number),'[]'::jsonb)
    into v_booked,v_minutes,v_student_slots from public.study_room_reservations where reservation_date=p_date and status='active';
  select coalesce(jsonb_agg(distinct slot),'[]'::jsonb) into v_pending
    from public.study_room_requests r cross join lateral unnest(r.slot_ids) slot
    where r.student_number=p_student_number and r.reservation_date=p_date and r.status='pending';
  return jsonb_build_object('students',case when jsonb_array_length(v_matches)>20 then v_matches-20 else v_matches end,
    'hasMore',jsonb_array_length(v_matches)>20,'student',v_student,'date',p_date,
    'booked',v_booked,'closedSlotIds',coalesce(v_setting.closed_slot_ids,'[]'::jsonb),
    'limitMinutes',coalesce(v_setting.limit_minutes,0),'studentMinutes',v_minutes,'pendingSlotIds',v_pending,'studentSlotIds',v_student_slots);
end;
$$;
revoke all on function public.staff_study_room_intake_options(uuid,uuid,date,text,text) from public,anon,authenticated;
grant execute on function public.staff_study_room_intake_options(uuid,uuid,date,text,text) to service_role;
commit;
