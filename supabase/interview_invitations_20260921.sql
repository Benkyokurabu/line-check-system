-- KUDO-only production pilot. Run after interview_pilot_notifications_20260921.sql.
create table public.interview_invitations (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references interview_students(id),
 created_by uuid not null references staff_accounts(id), recipient text not null,
 teacher text not null, slots jsonb not null, expires_at timestamptz not null,
 status text not null default 'active' check(status in ('active','revoked','declined')),
 version integer not null default 1, created_at timestamptz not null default now(),
 notification_status text not null default 'pending' check(notification_status in ('pending','sending','retry','sent','blocked','obsolete')),
 message text not null, retry_key uuid not null unique default gen_random_uuid(),
 first_attempt_at timestamptz,next_attempt_at timestamptz,lease uuid,lease_until timestamptz,
 attempts integer not null default 0,line_request_id text,error text,sent_at timestamptz
);
create unique index interview_invitation_active_student on interview_invitations(student_id) where status='active';
create table public.interview_invitation_events(operation_key uuid primary key,actor uuid not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now());
alter table interview_parent_requests add column invitation_id uuid references interview_invitations(id);
alter table interview_invitations enable row level security;
alter table interview_invitation_events enable row level security;
revoke all on interview_invitations,interview_invitation_events from public,anon,authenticated;
grant all on interview_invitations,interview_invitation_events to service_role;

create function public.interview_invitation_identity(p_student uuid,p_recipient text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from interview_pilot_notification_config c join staff_accounts a on a.id=c.staff_id
 join student_registry r on r.student_number=c.student_number
 join student_line_accounts l on l.student_number=r.student_number and l.line_user_id=c.recipient
 where c.id and c.enabled and a.active and a.staff_code='KUDO' and c.student_number='2018999'
 and r.enrollment_status='current_roster' and r.interview_student_id=p_student and c.recipient=p_recipient
 and l.relation='student' and l.verification_status='confirmed');
$$;
create function public.interview_invitation_save(p_user uuid,p_session uuid,p_operation uuid,p_action text,p_student uuid,p_slots jsonb,p_expires timestamptz,p_id uuid,p_version integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor jsonb;e interview_invitation_events%rowtype;i interview_invitations%rowtype;c interview_pilot_notification_config%rowtype;
 payload jsonb;teacher text;choice jsonb;s interview_public_slots%rowtype;dates text;result jsonb;
begin
 actor:=staff_authorize(p_user,p_session,null,false);
 if actor->>'staffCode' is distinct from 'KUDO' or coalesce(actor->>'role','') not in ('admin','office','employee') then raise exception 'staff_permission_denied';end if;
 perform 1 from interview_settings where id for update;
 select * into c from interview_pilot_notification_config where id and enabled;
 if not found or c.staff_id<>(actor->>'staffId')::uuid then raise exception 'pilot_only';end if;
 payload:=jsonb_build_object('action',p_action,'student',p_student,'slots',p_slots,'expires',p_expires,'id',p_id,'version',p_version);
 select * into e from interview_invitation_events where operation_key=p_operation;
 if found then
  if e.actor<>(actor->>'staffId')::uuid or e.payload<>payload then raise exception 'idempotency_conflict';end if;
  return e.result;
 end if;
 if p_action='create' then
  if not interview_invitation_identity(p_student,c.recipient) then raise exception 'pilot_only';end if;
  if p_expires is null or p_expires<=now() or p_expires>now()+interval '60 days' then raise exception 'invalid_invitation';end if;
  if jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots) not between 1 and 200 then raise exception 'invalid_invitation';end if;
  if (select count(distinct v->>'id') from jsonb_array_elements(p_slots) v)<>jsonb_array_length(p_slots) then raise exception 'invalid_invitation';end if;
  if exists(select 1 from interview_parent_requests q left join interview_bookings b on b.id=q.booking_id where q.student_id=p_student and (q.status='pending' or q.status='approved' and b.status='confirmed' and b.data->>'date'>=(now() at time zone 'Asia/Tokyo')::date::text)) then raise exception 'request_already_active';end if;
  select homeroom_teacher into teacher from student_registry where interview_student_id=p_student;
  for choice in select * from jsonb_array_elements(p_slots) loop
   select * into s from interview_public_slots where id=(choice->>'id')::uuid;
   if not found or s.version is distinct from (choice->>'version')::int or not interview_slot_available(s.id,teacher) then raise exception 'slot_changed';end if;
   if p_expires>=(s.data->>'date')::date::timestamp at time zone 'Asia/Tokyo' then raise exception 'invalid_invitation';end if;
  end loop;
  if exists(select 1 from interview_invitations where student_id=p_student and status='active' and expires_at>now()) then raise exception 'invitation_already_active';end if;
  update interview_invitations set status='revoked',version=version+1 where student_id=p_student and status='active';
  select string_agg(d, '、' order by d) into dates from (select distinct slot_row.data->>'date' d from interview_public_slots slot_row join jsonb_array_elements(p_slots) v on slot_row.id=(v->>'id')::uuid) ds;
  insert into interview_invitations(student_id,created_by,recipient,teacher,slots,expires_at,message)
  values(p_student,c.staff_id,c.recipient,interview_teacher_key(teacher),p_slots,p_expires,
   E'【工藤専用・動作確認】\nオンライン面談の日程をご案内します。\n対象：検証用 工藤\n担当：'||interview_teacher_key(teacher)||E'先生\n案内日：'||dates||E'\n回答期限：'||to_char(p_expires at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI')||E'\nLINE下部の「面談予約」から希望時間をお選びください。\nこれは検証用で、実際の面談ではありません。') returning * into i;
 elsif p_action in ('revoke','decline') then
  select * into i from interview_invitations where id=p_id for update;
  if not found or not interview_invitation_identity(i.student_id,i.recipient) then raise exception 'pilot_only';end if;
  if i.version is distinct from p_version or i.status<>'active' then raise exception 'version_conflict';end if;
  if exists(select 1 from interview_parent_requests q join interview_bookings b on b.id=q.booking_id where q.invitation_id=i.id and q.status='approved' and b.status='confirmed') then raise exception 'request_already_active';end if;
  if i.lease_until>now() then raise exception 'notification_in_progress';end if;
  update interview_invitations set status=case when p_action='revoke' then 'revoked' else 'declined' end,version=version+1 where id=i.id returning * into i;
  update interview_parent_requests set status='rejected',reason='案内の日程を見直します。教室からの再案内をお待ちください。',version=version+1,updated_at=now() where invitation_id=i.id and status='pending';
 else raise exception 'invalid_invitation';end if;
 result:=jsonb_build_object('id',i.id,'status',i.status,'version',i.version);
 insert into interview_invitation_events(operation_key,actor,payload,result) values(p_operation,(actor->>'staffId')::uuid,payload,result);
 return result;
end;$$;

create function public.interview_invitation_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare i interview_invitations%rowtype;choice jsonb;
begin
 if tg_op='UPDATE' and not (new.status='approved' and old.status='pending') then return new;end if;
 if tg_op='UPDATE' and old.invitation_id is null then return new;end if; -- preserve pre-rollout requests
 if new.line_user_id<>'BENTAN-KUDO-INTERVIEW-LIVE-PREVIEW' then raise exception 'pilot_only';end if;
 if tg_op='INSERT' then
  select * into i from interview_invitations where student_id=new.student_id and status='active' and expires_at>now() for update;
 else select * into i from interview_invitations where id=new.invitation_id and status='active' for update;end if;
 if not found or not interview_invitation_identity(new.student_id,i.recipient) then raise exception 'invitation_required';end if;
 if not exists(select 1 from student_registry where interview_student_id=new.student_id and interview_teacher_key(homeroom_teacher)=i.teacher) then raise exception 'slot_changed';end if;
 for choice in select * from jsonb_array_elements(new.choices) loop
  if not exists(select 1 from jsonb_array_elements(i.slots) v where v->>'id'=choice->>'slotId' and (v->>'version')::int=(choice->>'version')::int) then raise exception 'invitation_slot_denied';end if;
 end loop;
 new.invitation_id:=i.id;return new;
end;$$;
create trigger interview_invitation_guard before insert or update on interview_parent_requests for each row execute function interview_invitation_guard();

create function public.interview_invited_submit(p_hash text,p_operation uuid,p_student uuid,p_choices uuid[],p_note text,p_invitation uuid,p_version integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i interview_invitations%rowtype;e interview_request_events%rowtype;
begin
 perform 1 from interview_settings where id for update;
 perform interview_parent_subject(p_hash,p_student);
 select * into e from interview_request_events where operation_key=p_operation;
 if found then
  if e.result->>'invitation_id' is distinct from p_invitation::text then raise exception 'idempotency_conflict';end if;
  return interview_parent_submit(p_hash,p_operation,p_student,p_choices,p_note);
 end if;
 select * into i from interview_invitations where id=p_invitation and student_id=p_student and status='active' and expires_at>now() for update;
 if not found or i.version is distinct from p_version then raise exception 'invitation_required';end if;
 return interview_parent_submit(p_hash,p_operation,p_student,p_choices,p_note);
end;$$;
revoke all on function interview_invited_submit(text,uuid,uuid,uuid[],text,uuid,integer) from public,anon,authenticated;
grant execute on function interview_invited_submit(text,uuid,uuid,uuid[],text,uuid,integer) to service_role;

create function public.interview_invitation_notification_claim(p_invitation uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare i interview_invitations%rowtype;
begin
 select * into i from interview_invitations where id=p_invitation for update skip locked;
 if not found or i.notification_status in ('sent','blocked','obsolete') or i.lease_until>now() or i.next_attempt_at>now() then return null;end if;
 if i.status<>'active' or i.expires_at<=now() then update interview_invitations set notification_status='obsolete' where id=i.id;return null;end if;
 if not interview_invitation_identity(i.student_id,i.recipient) or i.first_attempt_at<now()-interval '23 hours' then
  update interview_invitations set notification_status='blocked',error='identity_or_retry_window' where id=i.id;return null;end if;
 update interview_invitations set notification_status='sending',lease=gen_random_uuid(),lease_until=now()+interval '60 seconds',first_attempt_at=coalesce(first_attempt_at,now()),next_attempt_at=null,attempts=attempts+1 where id=i.id returning * into i;
 return to_jsonb(i);
end;$$;
create function public.interview_invitation_notification_finish(p_invitation uuid,p_lease uuid,p_result text,p_request_id text,p_error text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare i interview_invitations%rowtype;
begin
 select * into i from interview_invitations where id=p_invitation and lease=p_lease and notification_status='sending' for update;
 if not found then return false;end if;
 if p_result not in ('sent','retry','blocked') then raise exception 'invalid_notification_result';end if;
 if p_result='sent' then
  insert into line_messages(line_message_id,line_user_id,direction,message_type,text,sent_by,received_at,raw_event)
  values('interview_invitation_'||i.retry_key,i.recipient,'outbound','text',i.message,'面談案内・工藤検証',now(),jsonb_build_object('send_context','interview_kudo_invitation','invitation_id',i.id,'retry_key',i.retry_key,'line_request_id',p_request_id)) on conflict(line_message_id) do nothing;
 end if;
 update interview_invitations set notification_status=p_result,lease=null,lease_until=null,line_request_id=p_request_id,error=left(p_error,500),sent_at=case when p_result='sent' then now() else sent_at end,next_attempt_at=case when p_result='retry' then now()+interval '30 seconds' else null end where id=i.id;
 return true;
end;$$;
revoke all on function interview_invitation_identity(uuid,text),interview_invitation_save(uuid,uuid,uuid,text,uuid,jsonb,timestamptz,uuid,integer),interview_invitation_guard(),interview_invitation_notification_claim(uuid),interview_invitation_notification_finish(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function interview_invitation_identity(uuid,text),interview_invitation_save(uuid,uuid,uuid,text,uuid,jsonb,timestamptz,uuid,integer),interview_invitation_notification_claim(uuid),interview_invitation_notification_finish(uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
