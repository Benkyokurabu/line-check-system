begin;
create table if not exists public.interview_settings (
 id boolean primary key default true check(id), version bigint not null default 1,
 data jsonb not null default '{"duration":45,"buffer":15,"start":"13:00","daytime":["13:00","14:00","15:00","16:00","17:00"],"evening":["20:30","21:30"],"flexibleStart":"18:35","flexibleEnd":"20:05","step":5}',
 notion_source_id uuid, notion_status text not null default '未接続'
);
insert into public.interview_settings(id) values(true) on conflict do nothing;
create table if not exists public.interview_students (
 id uuid primary key default gen_random_uuid(), student_number text not null unique,
 notion_page_id uuid unique, created_at timestamptz not null default now()
);
insert into public.interview_students(student_number,notion_page_id)
 select student_number,notion_page_id from public.student_registry
 where notion_page_id is null or notion_page_id in
 (select notion_page_id from public.student_registry group by notion_page_id having count(*)=1)
 on conflict do nothing;
create table if not exists public.interview_bookings (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.interview_students(id),
 data jsonb not null, status text not null check(status in ('pending','confirmed','completed','cancelled','rejected')),
 version integer not null default 1, created_by uuid not null references public.staff_accounts(id),
 updated_at timestamptz not null default now(), notion_page_id uuid unique,
 notion_synced_version integer not null default 0, notion_edited_at timestamptz, sync_error text,
 sync_lease uuid, sync_lease_until timestamptz,
 check(jsonb_typeof(data)='object')
);
create table if not exists public.interview_slot_overrides (
 key text primary key, data jsonb not null, updated_by uuid not null references public.staff_accounts(id),
 updated_at timestamptz not null default now()
);
create table if not exists public.interview_events (
 id uuid primary key default gen_random_uuid(), operation_key uuid not null unique,
 actor uuid not null references public.staff_accounts(id), booking_id uuid references public.interview_bookings(id),
 action text not null, before_value jsonb, after_value jsonb, reason text not null default '',
 created_at timestamptz not null default now(), request jsonb not null, request_hash text not null
);

create or replace function public.interview_snapshot() returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select md5(concat(
 (select version from interview_settings where id),
 (select coalesce(string_agg(id::text||version::text,',' order by id),'') from interview_bookings),
 (select coalesce(string_agg(id::text||updated_at::text,',' order by id),'') from lessons),
 (select coalesce(string_agg(student_number||updated_at::text,',' order by student_number),'') from student_registry)
 ));
$$;

create or replace function public.interview_save(
 p_auth_user_id uuid,p_auth_session_id uuid,p_operation_key uuid,p_snapshot text,
 p_action text,p_id uuid,p_version integer,p_data jsonb,p_reason text default '',p_request_hash text default ''
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb; previous interview_bookings%rowtype; saved interview_bookings%rowtype;
 event interview_events%rowtype; payload jsonb; result jsonb; privileged boolean; student record;
begin
 s:=staff_authorize(p_auth_user_id,p_auth_session_id,null,false);
 privileged:=s->>'role' in ('admin','office','employee');
 perform 1 from interview_settings where id for update;
 payload:=jsonb_build_object('action',p_action,'id',p_id,'version',p_version,'data',p_data,'reason',p_reason);
 select * into event from interview_events where operation_key=p_operation_key;
 if found then
  if event.actor<>(s->>'staffId')::uuid or event.request_hash<>p_request_hash or event.request<>payload then raise exception 'idempotency_conflict'; end if;
  return event.after_value;
 end if;
 lock table lessons in share mode;
 lock table student_registry in share mode;
 if p_snapshot<>interview_snapshot() then raise exception 'version_conflict'; end if;
 if not privileged then raise exception 'staff_permission_denied'; end if;
 if p_action='settings' then
  if jsonb_typeof(p_data)<>'object' then raise exception 'invalid_request'; end if;
  result:=p_data;
  insert into interview_events(operation_key,actor,action,before_value,after_value,request,reason,request_hash)
   select p_operation_key,(s->>'staffId')::uuid,p_action,data,result,payload,p_reason,p_request_hash from interview_settings where id;
  update interview_settings set data=p_data,version=version+1 where id;
  return result;
 elsif p_action='slot' then
  if length(p_data->>'key') not between 1 and 200 then raise exception 'invalid_request'; end if;
  insert into interview_slot_overrides(key,data,updated_by) values(p_data->>'key',p_data,(s->>'staffId')::uuid)
   on conflict(key) do update set data=excluded.data,updated_by=excluded.updated_by,updated_at=now();
  update interview_settings set version=version+1 where id;
  result:=p_data;
 elsif p_action in ('create','update','confirm','cancel','reject','complete','record') then
  if p_action<>'create' then
   select * into previous from interview_bookings where id=p_id for update;
   if not found or previous.version<>p_version then raise exception 'version_conflict'; end if;
   if previous.sync_lease_until>clock_timestamp() then raise exception 'version_conflict'; end if;
   if previous.status in ('completed','cancelled','rejected') and p_action<>'record' then raise exception 'invalid_state_transition'; end if;
   if p_action='record' and previous.status<>'completed' then raise exception 'invalid_state_transition'; end if;
   if p_action='record' and previous.data->'record'->>'state'='final' and length(btrim(p_reason))=0 then raise exception 'reason_required'; end if;
   if p_action='confirm' and previous.status<>'pending' then raise exception 'invalid_state_transition'; end if;
   if p_action='complete' and previous.status<>'confirmed' then raise exception 'invalid_state_transition'; end if;
   if p_action in ('update','cancel','reject') and length(btrim(p_reason))=0 then raise exception 'reason_required'; end if;
  end if;
  if p_action in ('create','update') then
   select r.*,i.id into student from interview_students i join student_registry r using(student_number)
    where i.id=(p_data->>'studentId')::uuid;
   if not found then raise exception 'student_missing'; end if;
   p_data:=p_data||jsonb_build_object('studentName',student.student_name,'studentNumber',student.student_number,'grade',student.grade);
   if p_action='create' then
    insert into interview_bookings(student_id,data,status,created_by)
      values(student.id,p_data,'pending',(s->>'staffId')::uuid) returning * into saved;
   else
    update interview_bookings set student_id=student.id,data=p_data,version=version+1,updated_at=now()
     where id=p_id returning * into saved;
   end if;
  else
   update interview_bookings set status=case p_action when 'confirm' then 'confirmed' when 'cancel' then 'cancelled'
      when 'reject' then 'rejected' when 'complete' then 'completed' when 'record' then status end,
      data=case when p_action in ('complete','record') then data||jsonb_build_object('record',p_data||jsonb_build_object('updatedBy',s->>'staffId','updatedAt',now())) else data end,
      version=version+1,updated_at=now() where id=p_id returning * into saved;
  end if;
  result:=to_jsonb(saved);
 else raise exception 'invalid_request'; end if;
 insert into interview_events(operation_key,actor,booking_id,action,before_value,after_value,reason,request,request_hash)
 values(p_operation_key,(s->>'staffId')::uuid,saved.id,p_action,
  case when previous.id is not null then to_jsonb(previous) else null end,result,p_reason,payload,p_request_hash);
 return result;
end;
$$;

create or replace function public.interview_sync_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b interview_bookings%rowtype; lease uuid:=gen_random_uuid();
begin
 perform 1 from interview_settings where id for update;
 select * into b from interview_bookings where id=p_id for update;
 if not found or b.status='pending' or b.notion_synced_version=b.version
  or b.sync_lease_until>clock_timestamp() then return null; end if;
 if b.sync_lease is not null and b.notion_page_id is null then
   update interview_bookings set sync_error='create_uncertain' where id=p_id;
   b.sync_error:='create_uncertain';
 end if;
 update interview_bookings set sync_lease=lease,sync_lease_until=clock_timestamp()+interval '5 minutes' where id=p_id;
 return to_jsonb(b)||jsonb_build_object('lease',lease);
end;$$;
create or replace function public.interview_sync_finish(p_id uuid,p_lease uuid,p_result jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from interview_settings where id for update;
 update interview_bookings set
  notion_page_id=case when p_result->>'status'='synced' then (p_result->>'pageId')::uuid else notion_page_id end,
  notion_edited_at=case when p_result->>'status'='synced' then (p_result->>'editedAt')::timestamptz else notion_edited_at end,
  notion_synced_version=case when p_result->>'status'='synced' then version else notion_synced_version end,
  sync_error=case when p_result->>'status'='synced' then null when p_result->>'status'='uncertain' then 'create_uncertain' else p_result->>'message' end,
  sync_lease=null,sync_lease_until=null where id=p_id and sync_lease=p_lease;
 if not found then raise exception 'version_conflict'; end if;
end;$$;

alter table interview_settings enable row level security;
alter table interview_students enable row level security;
alter table interview_bookings enable row level security;
alter table interview_slot_overrides enable row level security;
alter table interview_events enable row level security;
revoke all on interview_settings,interview_students,interview_bookings,interview_slot_overrides,interview_events from anon,authenticated;
grant all on interview_settings,interview_students,interview_bookings,interview_slot_overrides,interview_events to service_role;
revoke all on function interview_snapshot(),interview_save(uuid,uuid,uuid,text,text,uuid,integer,jsonb,text,text) from public,anon,authenticated;
grant execute on function interview_snapshot(),interview_save(uuid,uuid,uuid,text,text,uuid,integer,jsonb,text,text) to service_role;
revoke all on function interview_sync_claim(uuid),interview_sync_finish(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function interview_sync_claim(uuid),interview_sync_finish(uuid,uuid,jsonb) to service_role;
commit;
