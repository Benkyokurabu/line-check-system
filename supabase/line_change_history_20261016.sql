-- Keep existing audit rows. Name/group updates and their audit are one transaction.
create or replace function public.update_line_contact_alias(
  p_line_user_id text, p_alias_name text, p_has_alias boolean,
  p_group_name text, p_has_group boolean, p_performed_by text,
  p_delete boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  previous_alias jsonb;
  next_alias text;
  next_group text;
begin
  if nullif(btrim(p_line_user_id), '') is null then raise exception using errcode='22023', message='LINE user ID is required'; end if;
  if not p_delete and (not (p_has_alias or p_has_group) or (p_has_alias and (nullif(btrim(p_alias_name), '') is null or length(p_alias_name)>200))) then
    raise exception using errcode='22023', message='更新内容を確認してください';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('line_alias:' || p_line_user_id, 0));
  select to_jsonb(a) into previous_alias from public.line_user_aliases a where line_user_id=p_line_user_id for update;
  next_alias := case when p_has_alias then btrim(p_alias_name) else previous_alias->>'alias_name' end;
  next_group := case when p_has_group then nullif(btrim(p_group_name),'') else previous_alias->>'group_name' end;
  if p_delete then
    if previous_alias is null then return jsonb_build_object('ok',true,'unchanged',true); end if;
    next_alias := null; next_group := null;
    delete from public.line_user_aliases where line_user_id=p_line_user_id;
  else
    if previous_alias is not null and (previous_alias->>'alias_name') is not distinct from next_alias
      and (previous_alias->>'group_name') is not distinct from next_group then return jsonb_build_object('ok',true,'unchanged',true); end if;
    insert into public.line_user_aliases(line_user_id,alias_name,group_name,updated_at)
      values(p_line_user_id,next_alias,next_group,now()) on conflict(line_user_id) do update
      set alias_name=excluded.alias_name,group_name=excluded.group_name,updated_at=excluded.updated_at;
  end if;
  insert into public.line_contact_registration_events(line_user_id,action,alias_name,performed_by,source,previous_value)
    values(p_line_user_id,'updated',next_alias,coalesce(nullif(btrim(p_performed_by),''),'担当者の記録なし'),
      case when p_delete then 'contacts_alias_clear' when p_has_alias then 'contacts_name_edit' else 'contacts_group_edit' end,
      jsonb_build_object('alias_name',previous_alias->>'alias_name','group_name',previous_alias->>'group_name','after_group_name',next_group));
  return jsonb_build_object('ok',true,'alias_name',next_alias);
end $$;

create or replace function public.get_line_change_history(p_line_user_id text, p_candidate_id uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with changes as (
    select 'registration:'||e.id::text id, e.created_at, e.performed_by actor,
      case when e.source in ('contacts_name_edit','contacts_alias_clear','students_name_edit') then 'name'
        when e.source='contacts_group_edit' then 'group' else 'registration' end kind,
      e.action, null::uuid candidate_id, null::text message_text,
      e.previous_value before_value,
      case when e.action='revoked' then null else jsonb_build_object('student_number',e.student_number,
        'student_name',s.student_name,'relation',e.relation,'alias_name',e.alias_name,
        'group_name',e.previous_value->>'after_group_name') end after_value
    from public.line_contact_registration_events e
      left join public.student_roster s on s.student_number=e.student_number
    where e.line_user_id=p_line_user_id
    union all
    select 'attendance:'||a.id::text, a.created_at, a.actor, 'attendance', 'updated', a.candidate_id,
      left(m.text,120),
      jsonb_build_object('student_number',a.before_student_number,'student_name',b.student_name,'lessons',a.before_lessons),
      jsonb_build_object('student_number',a.after_student_number,'student_name',s.student_name,'lessons',a.after_lessons)
    from public.attendance_candidate_review_audit a
      join public.attendance_candidates c on c.id=a.candidate_id
      join public.line_messages m on m.id=c.source_message_id
      left join public.student_roster b on b.student_number=a.before_student_number
      left join public.student_roster s on s.student_number=a.after_student_number
    where m.line_user_id=p_line_user_id and (p_candidate_id is null or a.candidate_id=p_candidate_id)
  ), recent as (select * from changes order by created_at desc,id desc limit 50)
  select coalesce(jsonb_agg(to_jsonb(recent) order by created_at desc,id desc),'[]'::jsonb) from recent;
$$;
revoke all on function public.update_line_contact_alias(text,text,boolean,text,boolean,text,boolean) from public,anon,authenticated;
revoke all on function public.get_line_change_history(text,uuid) from public,anon,authenticated;
grant execute on function public.update_line_contact_alias(text,text,boolean,text,boolean,text,boolean) to service_role;
grant execute on function public.get_line_change_history(text,uuid) to service_role;
