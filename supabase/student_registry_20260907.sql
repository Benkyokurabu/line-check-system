-- Persistent people registry; teaching roster remains unchanged.
create table if not exists public.student_registry (
  student_number text primary key,
  student_name text not null,
  grade text not null,
  campus text,
  school_name text,
  homeroom_teacher text,
  instruction_type text,
  gender text,
  source_file text,
  enrollment_status text not null default 'current_roster',
  notion_page_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.study_room_eligibilities (
  student_number text primary key references public.student_registry(student_number) on delete restrict,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.student_registry enable row level security;
alter table public.study_room_eligibilities enable row level security;
revoke all on public.student_registry, public.study_room_eligibilities from public, anon, authenticated;
grant all on public.student_registry, public.study_room_eligibilities to service_role;

insert into public.student_registry (student_number,student_name,grade,campus,school_name,homeroom_teacher,instruction_type,gender,source_file)
select student_number,student_name,grade,campus,school_name,homeroom_teacher,instruction_type,gender,source_file from public.student_roster
on conflict(student_number) do nothing;

create or replace function public.sync_teaching_roster_registry()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  -- Never silently re-enrol a manually registered former student from an import.
  if exists(select 1 from public.student_registry where student_number=new.student_number and enrollment_status <> 'current_roster') then
    raise exception 'Explicit enrolment reconciliation required';
  end if;
  insert into public.student_registry(student_number,student_name,grade,campus,school_name,homeroom_teacher,instruction_type,gender,source_file)
  values(new.student_number,new.student_name,new.grade,new.campus,new.school_name,new.homeroom_teacher,new.instruction_type,new.gender,new.source_file)
  on conflict(student_number) do update set student_name=excluded.student_name,grade=excluded.grade,campus=excluded.campus,
    school_name=excluded.school_name,homeroom_teacher=excluded.homeroom_teacher,instruction_type=excluded.instruction_type,
    gender=excluded.gender,source_file=excluded.source_file,updated_at=now();
  return new;
end $$;
drop trigger if exists sync_teaching_roster_registry on public.student_roster;
create trigger sync_teaching_roster_registry after insert or update on public.student_roster
for each row execute function public.sync_teaching_roster_registry();
revoke all on function public.sync_teaching_roster_registry() from public,anon,authenticated;

-- Retain all existing account and audit rows while extending their subject domain.
alter table public.student_line_accounts drop constraint if exists student_line_accounts_student_number_fkey;
alter table public.student_line_accounts add constraint student_line_accounts_student_number_fkey
 foreign key(student_number) references public.student_registry(student_number) on delete restrict;
alter table public.line_contact_registration_events drop constraint if exists line_contact_registration_events_student_number_fkey;
alter table public.line_contact_registration_events add constraint line_contact_registration_events_student_number_fkey
 foreign key(student_number) references public.student_registry(student_number) on delete set null;
alter table public.line_contact_registration_events drop constraint if exists line_contact_registration_events_relation_check;
alter table public.line_contact_registration_events add constraint line_contact_registration_events_relation_check
 check (relation is null or relation in ('student','mother','father','guardian','family','shared','unknown'));

-- Preserve the deployed summary's columns (including instruction type additions).
do $$ declare definition text; begin
  definition := pg_get_functiondef('public.get_line_contact_admin_summaries()'::regprocedure);
  if position('public.student_roster' in definition)>0 then
    definition := replace(definition,'public.student_roster','public.student_registry');
  end if;
  if position('''enrollment_status''' in definition)=0 then
    definition := replace(definition,'''grade'', roster.grade,',
      '''grade'', roster.grade, ''enrollment_status'', roster.enrollment_status, ''study_room_enabled'', exists(select 1 from public.study_room_eligibilities eligibility where eligibility.student_number=roster.student_number and eligibility.enabled),');
  end if;
  execute definition;
  definition := pg_get_functiondef('public.verify_line_contact(text,jsonb,text,text,uuid,text)'::regprocedure);
  definition := replace(definition,'select 1 from public.student_roster where student_number = target_student_number',
    'select 1 from public.student_registry where student_number = target_student_number');
  definition := replace(definition,'if target_is_primary then',
    'if target_is_primary and exists(select 1 from public.student_roster where student_number=target_student_number) then');
  execute definition;
end $$;

create or replace function public.register_study_room_former_student(
  p_student jsonb, p_line_user_id text, p_friend_display_name text, p_alias_name text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  sn text := btrim(coalesce(p_student->>'student_number',''));
  nm text := btrim(coalesce(p_student->>'student_name',''));
  gr text := btrim(coalesce(p_student->>'grade',''));
  ca text := btrim(coalesce(p_student->>'campus',''));
  np uuid := (p_student->>'notion_page_id')::uuid;
  previous_person jsonb; previous_account jsonb; previous_eligibility jsonb;
  changed_count integer;
begin
  if jsonb_typeof(p_student) is distinct from 'object' or sn='' or nm='' or gr='' or ca='' or np is null
    or p_student->>'enrollment_status' is distinct from '卒塾' then raise exception 'Complete former student identity required'; end if;
  if length(sn)>100 or length(nm)>200 or length(gr)>100 or length(ca)>100
    or nullif(btrim(p_line_user_id),'') is null or length(p_line_user_id)>255
    or nullif(btrim(p_friend_display_name),'') is null or length(p_friend_display_name)>200
    or nullif(btrim(p_alias_name),'') is null or length(p_alias_name)>200 then raise exception 'Invalid contact'; end if;
  perform pg_advisory_xact_lock(hashtextextended('registry:'||sn,0));
  perform pg_advisory_xact_lock(hashtextextended('line:'||p_line_user_id,0));
  if exists(select 1 from public.student_roster where student_number=sn) then raise exception 'Teaching roster subject cannot be registered as former'; end if;
  if exists(select 1 from public.student_line_accounts where line_user_id=p_line_user_id and student_number<>sn)
    or exists(select 1 from public.student_line_links where line_user_id=p_line_user_id)
    then raise exception 'Existing LINE association requires review'; end if;
  select to_jsonb(r) into previous_person from public.student_registry r where student_number=sn for update;
  select to_jsonb(a) into previous_account from public.student_line_accounts a where student_number=sn and line_user_id=p_line_user_id for update;
  select to_jsonb(e) into previous_eligibility from public.study_room_eligibilities e where student_number=sn for update;
  if previous_person is not null and (
    previous_person->>'student_name' is distinct from nm or previous_person->>'grade' is distinct from gr
    or previous_person->>'campus' is distinct from ca or previous_person->>'enrollment_status' is distinct from '卒塾'
    or previous_person->>'notion_page_id' is distinct from np::text) then raise exception 'Registry identity conflict'; end if;
  if previous_account is not null then
    if previous_person is not null and previous_account->>'relation'='shared'
      and previous_account->>'verification_status'='confirmed' and previous_account->>'verification_source'='user_instruction'
      and previous_account->>'is_primary'='false' and previous_account->>'alias_name'=p_alias_name
      and previous_account->>'friend_display_name'=p_friend_display_name and previous_eligibility->>'enabled'='true'
      and exists(select 1 from public.line_user_aliases where line_user_id=p_line_user_id and alias_name=p_alias_name)
      then return jsonb_build_object('ok',true,'already_registered',true); end if;
    raise exception 'Existing contact requires explicit update';
  end if;
  if exists(select 1 from public.line_user_aliases where line_user_id=p_line_user_id and alias_name is not null and alias_name<>p_alias_name)
    then raise exception 'Existing registered name requires review'; end if;
  insert into public.student_registry(student_number,student_name,grade,campus,enrollment_status,notion_page_id,source_file)
    values(sn,nm,gr,ca,'卒塾',np,'user_instruction') on conflict(student_number) do nothing;
  insert into public.study_room_eligibilities(student_number,enabled) values(sn,true)
    on conflict(student_number) do update set enabled=true,updated_at=now();
  insert into public.student_line_accounts(student_number,line_user_id,relation,alias_name,friend_display_name,source,is_primary,
    verification_status,verified_by,verified_at,evidence_message_id,verification_source,updated_at)
    values(sn,p_line_user_id,'shared',p_alias_name,p_friend_display_name,'manual',false,'confirmed','user_instruction',now(),null,'user_instruction',now());
  insert into public.line_user_aliases(line_user_id,alias_name,updated_at) values(p_line_user_id,p_alias_name,now())
    on conflict(line_user_id) do update set alias_name=excluded.alias_name,updated_at=now()
    where public.line_user_aliases.alias_name is null or public.line_user_aliases.alias_name=excluded.alias_name;
  get diagnostics changed_count = row_count;
  if changed_count<>1 then raise exception 'Concurrent registered name change'; end if;
  insert into public.line_contact_registration_events(line_user_id,student_number,action,relation,alias_name,friend_display_name,
    evidence_message_id,evidence_text,performed_by,source,previous_value)
    values(p_line_user_id,sn,'confirmed','shared',p_alias_name,p_friend_display_name,null,
    'Explicit user instruction: preserve former-student status, allow study-room use and register a shared student/guardian LINE account.',
    'user_instruction','user_instruction',jsonb_build_object('registry',previous_person,'account',previous_account,'eligibility',previous_eligibility));
  return jsonb_build_object('ok',true,'already_registered',false);
end $$;
revoke all on function public.register_study_room_former_student(jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.register_study_room_former_student(jsonb,text,text,text) to service_role;
notify pgrst, 'reload schema';
