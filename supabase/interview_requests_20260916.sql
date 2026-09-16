begin;
create table if not exists public.interview_parent_sessions (
 token_hash text primary key check(length(token_hash)=64),line_user_id text not null,
 expires_at timestamptz not null,created_at timestamptz not null default now()
);
create table if not exists public.interview_public_slots (
 id uuid primary key default gen_random_uuid(),notion_page_id uuid not null unique,
 data jsonb not null,notion_edited_at text not null,published boolean not null default true,
 version integer not null default 1,updated_by uuid not null references staff_accounts(id),updated_at timestamptz not null default now()
);
create table if not exists public.interview_parent_requests (
 id uuid primary key default gen_random_uuid(),student_id uuid not null references interview_students(id),
 line_user_id text not null,choices jsonb not null,note text not null default '',
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 version integer not null default 1,booking_id uuid references interview_bookings(id),
 selected_slot_id uuid references interview_public_slots(id),reason text not null default '',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(jsonb_array_length(choices) between 1 and 3),check(length(note)<=1500)
);
create table if not exists public.interview_request_events (
 operation_key uuid primary key,actor text not null,request_id uuid references interview_parent_requests(id),
 action text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
create index if not exists interview_parent_requests_student on interview_parent_requests(student_id,status);
create index if not exists interview_parent_sessions_expiry on interview_parent_sessions(expires_at);

create or replace function public.interview_teacher_key(p_value text) returns text
language sql immutable set search_path=public,pg_temp as $$
 select regexp_replace(replace(regexp_replace(coalesce(p_value,''),'[[:space:]　]','','g'),'高山','髙山'),'(先生|さん)$','');
$$;
create or replace function public.interview_parent_subject(p_hash text,p_student uuid) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare who text;
begin
 select line_user_id into who from interview_parent_sessions where token_hash=p_hash and expires_at>now();
 if not found then raise exception 'parent_session_required';end if;
 perform 1 from student_registry r join student_line_accounts a using(student_number)
 where r.interview_student_id=p_student and r.enrollment_status='current_roster'
 and a.line_user_id=who and a.verification_status='confirmed' and a.relation in ('mother','father','guardian','shared','student') for share of r,a;
 if not found then raise exception 'parent_subject_denied';end if;
 return who;
end;$$;

create or replace function public.interview_slot_available(p_slot uuid,p_teacher text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from interview_public_slots s where s.id=p_slot and s.published
 and s.data->>'method'='Zoom' and interview_teacher_key(s.data->>'teacher')=interview_teacher_key(p_teacher)
 and (s.data->>'date')::date>=(now() at time zone 'Asia/Tokyo')::date+2
 and not exists(select 1 from interview_bookings b where b.notion_page_id=s.notion_page_id
   or (b.status not in ('cancelled','rejected') and b.data->>'date'=s.data->>'date'
     and interview_teacher_key(b.data->>'teacher')=interview_teacher_key(s.data->>'teacher')
     and b.data->>'busyStart'<s.data->>'busyEnd' and s.data->>'busyStart'<b.data->>'busyEnd')));
$$;

create or replace function public.interview_parent_submit(p_hash text,p_operation uuid,p_student uuid,p_choices uuid[],p_note text default '') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare who text; payload jsonb; prior interview_request_events%rowtype;r interview_parent_requests%rowtype;
 choice uuid; slot interview_public_slots%rowtype; teacher text; choices jsonb:='[]';
begin
 perform 1 from interview_settings where id for update;
 who:=interview_parent_subject(p_hash,p_student);
 payload:=jsonb_build_object('studentId',p_student,'choices',p_choices,'note',p_note);
 select * into prior from interview_request_events where operation_key=p_operation;
 if found then
  if prior.actor<>'line:'||who or prior.payload<>payload or prior.action<>'submit' then raise exception 'idempotency_conflict';end if;
  return prior.result;
 end if;
 if coalesce(cardinality(p_choices),0) not between 1 and 3 or length(p_note)>1500 or p_note is null
 or cardinality(p_choices)<>(select count(distinct v) from unnest(p_choices) v) then raise exception 'invalid_choices';end if;
 if exists(select 1 from interview_parent_requests q left join interview_bookings b on b.id=q.booking_id
  where q.student_id=p_student and (q.status='pending' or (q.status='approved' and b.status in ('pending','confirmed') and (b.data->>'date')::date>=(now() at time zone 'Asia/Tokyo')::date))) then raise exception 'request_already_active';end if;
 select homeroom_teacher into teacher from student_registry where interview_student_id=p_student;
 foreach choice in array p_choices loop
  select * into slot from interview_public_slots where id=choice;
  if not found or not interview_slot_available(choice,teacher) then raise exception 'slot_unavailable';end if;
  choices:=choices||jsonb_build_array(jsonb_build_object('slotId',slot.id,'version',slot.version,'data',slot.data));
 end loop;
 insert into interview_parent_requests(student_id,line_user_id,choices,note) values(p_student,who,choices,p_note) returning * into r;
 insert into interview_request_events values(p_operation,'line:'||who,r.id,'submit',payload,to_jsonb(r),now());
 return to_jsonb(r);
end;$$;

create or replace function public.interview_parent_withdraw(p_hash text,p_operation uuid,p_id uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare who text;r interview_parent_requests%rowtype;e interview_request_events%rowtype;payload jsonb;
begin
 perform 1 from interview_settings where id for update;
 select * into r from interview_parent_requests where id=p_id for update;
 if not found then raise exception 'parent_subject_denied';end if;
 who:=interview_parent_subject(p_hash,r.student_id);payload:=jsonb_build_object('id',p_id,'version',p_version);
 select * into e from interview_request_events where operation_key=p_operation;
 if found then
  if e.actor<>'line:'||who or e.payload<>payload or e.action<>'withdraw' then raise exception 'idempotency_conflict';end if;return e.result;
 end if;
 if r.status<>'pending' or r.version<>p_version then raise exception 'version_conflict';end if;
 update interview_parent_requests set status='cancelled',version=version+1,updated_at=now() where id=p_id returning * into r;
 insert into interview_request_events values(p_operation,'line:'||who,r.id,'withdraw',payload,to_jsonb(r),now());return to_jsonb(r);
end;$$;

create or replace function public.interview_publish_slot(p_user uuid,p_session uuid,p_operation uuid,p_page uuid,p_data jsonb,p_edited text,p_published boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor jsonb;payload jsonb;e interview_request_events%rowtype;s interview_public_slots%rowtype;
begin
 actor:=staff_authorize(p_user,p_session,null,false);
 if coalesce(actor->>'staffCode','') not in ('KUDO','KINJO') or actor->>'role' not in ('admin','office','employee') then raise exception 'staff_permission_denied';end if;
 perform 1 from interview_settings where id for update;
 payload:=jsonb_build_object('page',p_page,'data',p_data,'edited',p_edited,'published',p_published);
 select * into e from interview_request_events where operation_key=p_operation;
 if found then
  if e.actor<>'staff:'||(actor->>'staffId') or e.action<>'publish' or e.payload<>payload then raise exception 'idempotency_conflict';end if;return e.result;
 end if;
 if p_published then
  if p_data->>'method' is distinct from 'Zoom' or length(coalesce(p_data->>'teacher',''))=0 or p_edited is null then raise exception 'invalid_slot';end if;
  insert into interview_public_slots(notion_page_id,data,notion_edited_at,published,updated_by)
  values(p_page,p_data,p_edited,true,(actor->>'staffId')::uuid)
  on conflict(notion_page_id) do update set data=excluded.data,notion_edited_at=excluded.notion_edited_at,published=true,version=interview_public_slots.version+1,updated_by=excluded.updated_by,updated_at=now() returning * into s;
 else
  update interview_public_slots set published=false,version=version+1,updated_by=(actor->>'staffId')::uuid,updated_at=now() where notion_page_id=p_page returning * into s;
  if not found then raise exception 'slot_unavailable';end if;
 end if;
 insert into interview_request_events values(p_operation,'staff:'||(actor->>'staffId'),null,'publish',payload,to_jsonb(s),now());return to_jsonb(s);
end;$$;

create or replace function public.interview_review_request(p_user uuid,p_session uuid,p_operation uuid,p_id uuid,p_version integer,p_action text,p_slot uuid,p_snapshot text,p_data jsonb,p_reason text,p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor jsonb;r interview_parent_requests%rowtype;e interview_request_events%rowtype;s interview_public_slots%rowtype;created jsonb;payload jsonb;teacher text;
begin
 actor:=staff_authorize(p_user,p_session,null,false);
 if coalesce(actor->>'staffCode','') not in ('KUDO','KINJO') or actor->>'role' not in ('admin','office','employee') then raise exception 'staff_permission_denied';end if;
 perform 1 from interview_settings where id for update;
 payload:=jsonb_build_object('hash',p_hash);
 select * into e from interview_request_events where operation_key=p_operation;
 if found then
  if e.actor<>'staff:'||(actor->>'staffId') or e.payload<>payload then raise exception 'idempotency_conflict';end if;return e.result;
 end if;
 select * into r from interview_parent_requests where id=p_id for update;
 if not found or r.status<>'pending' or r.version<>p_version then raise exception 'version_conflict';end if;
 if p_action='approve' then
  select homeroom_teacher into teacher from student_registry where interview_student_id=r.student_id and enrollment_status='current_roster';
  if not found then raise exception 'student_missing';end if;
  perform 1 from student_registry roster join student_line_accounts a using(student_number)
   where roster.interview_student_id=r.student_id and a.line_user_id=r.line_user_id
   and a.verification_status='confirmed' and a.relation in ('mother','father','guardian','shared','student') for share of a;
  if not found then raise exception 'parent_subject_denied';end if;
  select * into s from interview_public_slots where id=p_slot;
  if not found or not interview_slot_available(p_slot,teacher) then raise exception 'slot_unavailable';end if;
  if not exists(select 1 from jsonb_array_elements(r.choices) c where c->>'slotId'=p_slot::text and (c->>'version')::int=s.version) then raise exception 'slot_changed';end if;
  if p_data->>'studentId' is distinct from r.student_id::text or p_data->>'method' is distinct from 'Zoom'
   or p_data->'bensuke'->>'pageId' is distinct from s.notion_page_id::text
   or exists(select 1 from unnest(array['teacher','date','start','end','campus','room','busyStart','busyEnd']) k where p_data->>k is distinct from s.data->>k) then raise exception 'invalid_slot';end if;
  created:=interview_save(p_user,p_session,gen_random_uuid(),p_snapshot,'create',null,0,p_data,'保護者の面談希望を承認',p_hash);
  created:=interview_save(p_user,p_session,gen_random_uuid(),interview_snapshot(),'confirm',(created->>'id')::uuid,1,p_data,'保護者の面談希望を承認',p_hash);
  update interview_parent_requests set status='approved',booking_id=(created->>'id')::uuid,selected_slot_id=p_slot,version=version+1,updated_at=now() where id=p_id returning * into r;
 elsif p_action='reject' then
  if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'reason_required';end if;
  update interview_parent_requests set status='rejected',reason=p_reason,version=version+1,updated_at=now() where id=p_id returning * into r;
 else raise exception 'invalid_action';end if;
 insert into interview_request_events values(p_operation,'staff:'||(actor->>'staffId'),r.id,p_action,payload,to_jsonb(r),now());return to_jsonb(r);
end;$$;

alter table interview_parent_sessions enable row level security;
alter table interview_public_slots enable row level security;
alter table interview_parent_requests enable row level security;
alter table interview_request_events enable row level security;
revoke all on interview_parent_sessions,interview_public_slots,interview_parent_requests,interview_request_events from anon,authenticated;
grant all on interview_parent_sessions,interview_public_slots,interview_parent_requests,interview_request_events to service_role;
revoke all on function interview_teacher_key(text),interview_parent_subject(text,uuid),interview_slot_available(uuid,text),interview_parent_submit(text,uuid,uuid,uuid[],text),interview_parent_withdraw(text,uuid,uuid,integer),interview_publish_slot(uuid,uuid,uuid,uuid,jsonb,text,boolean),interview_review_request(uuid,uuid,uuid,uuid,integer,text,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function interview_teacher_key(text),interview_parent_subject(text,uuid),interview_slot_available(uuid,text),interview_parent_submit(text,uuid,uuid,uuid[],text),interview_parent_withdraw(text,uuid,uuid,integer),interview_publish_slot(uuid,uuid,uuid,uuid,jsonb,text,boolean),interview_review_request(uuid,uuid,uuid,uuid,integer,text,uuid,text,jsonb,text,text) to service_role;
commit;
