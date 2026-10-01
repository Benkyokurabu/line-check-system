-- Keep the Excel roster, its class memberships, and the import manifest in one transaction.
create or replace function public.import_roster_from_excel_atomic(
  p_roster jsonb, p_enrollments jsonb, p_manifest jsonb, p_expected_manifest jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  current_manifest jsonb;
  old_excel_count integer;
  new_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('bentan_roster_excel_import'));
  if jsonb_typeof(p_roster) is distinct from 'array' or jsonb_typeof(p_enrollments) is distinct from 'array'
     or jsonb_typeof(p_manifest) is distinct from 'array'
     or jsonb_array_length(p_roster)=0 or jsonb_array_length(p_enrollments)=0
     or jsonb_array_length(p_manifest)=0 then
    raise exception 'roster_import_empty_or_invalid';
  end if;
  select value into current_manifest from public.app_settings where key='roster_excel_import_manifest' for update;
  if current_manifest is distinct from p_expected_manifest then raise exception 'roster_manifest_changed';end if;
  if exists(select 1 from jsonb_to_recordset(p_roster) as r(student_number text) group by student_number having count(*)>1)
     or exists(select 1 from jsonb_to_recordset(p_enrollments) as e(student_number text,subject text,class_name text)
       group by student_number,subject,class_name having count(*)>1) then
    raise exception 'roster_import_duplicate';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_roster) as r(student_number text,grade text,student_name text,source_file text)
    where nullif(r.student_number,'') is null or nullif(r.grade,'') is null or nullif(r.student_name,'') is null
      or coalesce(r.source_file,'') not like '%クラス一覧表%')
    or exists(select 1 from jsonb_to_recordset(p_enrollments) as e(student_number text,grade text,subject text,class_name text,source_file text)
      where nullif(e.student_number,'') is null or nullif(e.grade,'') is null or nullif(e.subject,'') is null
        or nullif(e.class_name,'') is null or coalesce(e.source_file,'') not like '%クラス一覧表%') then
    raise exception 'roster_import_invalid_row';
  end if;
  select count(*) into old_excel_count from public.student_class_enrollments where source_file like '%クラス一覧表%';
  new_count:=jsonb_array_length(p_enrollments);
  if old_excel_count>=20 and new_count*5<old_excel_count*4 then raise exception 'roster_import_large_decrease';end if;

  insert into public.student_roster(student_number,grade,student_name,homeroom_teacher,campus,school_name,gender,source_file,updated_at)
  select r.student_number,r.grade,r.student_name,r.homeroom_teacher,r.campus,r.school_name,r.gender,r.source_file,now()
  from jsonb_to_recordset(p_roster) as r(student_number text,grade text,student_name text,homeroom_teacher text,
    campus text,school_name text,gender text,source_file text)
  on conflict(student_number) do update set grade=excluded.grade,student_name=excluded.student_name,
    homeroom_teacher=excluded.homeroom_teacher,campus=excluded.campus,school_name=excluded.school_name,
    gender=excluded.gender,source_file=excluded.source_file,updated_at=now();

  delete from public.student_class_enrollments old
  where old.source_file like '%クラス一覧表%'
    and not exists(select 1 from jsonb_to_recordset(p_enrollments) as incoming(student_number text,subject text,class_name text)
      where incoming.student_number=old.student_number and incoming.subject=old.subject and incoming.class_name=old.class_name);

  insert into public.student_class_enrollments(student_number,grade,subject,class_name,classroom,source_file,updated_at)
  select e.student_number,e.grade,e.subject,e.class_name,e.classroom,e.source_file,now()
  from jsonb_to_recordset(p_enrollments) as e(student_number text,grade text,subject text,class_name text,classroom text,source_file text)
  on conflict(student_number,subject,class_name) do update set grade=excluded.grade,classroom=excluded.classroom,
    source_file=excluded.source_file,updated_at=now()
  where public.student_class_enrollments.source_file like '%クラス一覧表%';

  insert into public.app_settings(key,value,description,updated_at)
  values('roster_excel_import_manifest',p_manifest,'Last imported roster Excel file names, sizes, and mtimes.',now())
  on conflict(key) do update set value=excluded.value,description=excluded.description,updated_at=now();
  return jsonb_build_object('students',jsonb_array_length(p_roster),'class_enrollments',new_count,
    'previous_excel_enrollments',old_excel_count);
end;$$;

revoke all on function public.import_roster_from_excel_atomic(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.import_roster_from_excel_atomic(jsonb,jsonb,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
