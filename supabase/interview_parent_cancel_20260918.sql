begin;

alter table public.interview_events alter column actor drop not null;
alter table public.interview_events drop constraint if exists interview_events_actor_source_check;
alter table public.interview_events add constraint interview_events_actor_source_check
  check(actor is not null or request->>'source'='parent');

create or replace function public.interview_parent_withdraw(
  p_hash text,p_operation uuid,p_id uuid,p_version integer
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  who text;
  r interview_parent_requests%rowtype;
  b interview_bookings%rowtype;
  before_booking jsonb;
  e interview_request_events%rowtype;
  payload jsonb;
  result jsonb;
begin
  perform 1 from interview_settings where id for update;
  select * into r from interview_parent_requests where id=p_id for update;
  if not found then raise exception 'parent_subject_denied';end if;
  who:=interview_parent_subject(p_hash,r.student_id);
  if r.line_user_id<>who then raise exception 'parent_subject_denied';end if;
  payload:=jsonb_build_object('id',p_id,'version',p_version);
  select * into e from interview_request_events where operation_key=p_operation;
  if found then
    if e.actor<>'line:'||who or e.payload<>payload or e.action<>'withdraw' then raise exception 'idempotency_conflict';end if;
    return e.result;
  end if;
  if r.version<>p_version or r.status not in ('pending','approved') then raise exception 'version_conflict';end if;
  if r.status='approved' then
    select * into b from interview_bookings where id=r.booking_id for update;
    if not found or b.status<>'confirmed' or (b.data->>'date')::date<(now() at time zone 'Asia/Tokyo')::date then raise exception 'version_conflict';end if;
    before_booking:=to_jsonb(b);
    update interview_bookings set status='cancelled',version=version+1,updated_at=now()
      where id=b.id returning * into b;
    insert into interview_events(operation_key,actor,booking_id,action,before_value,after_value,reason,request,request_hash)
      values(p_operation,null,b.id,'cancel',before_booking,to_jsonb(b),'保護者が予約画面から取消',
        jsonb_build_object('source','parent','requestId',r.id),md5(payload::text));
  end if;
  update interview_parent_requests set status='cancelled',version=version+1,updated_at=now()
    where id=p_id returning * into r;
  result:=jsonb_build_object('request',to_jsonb(r),'booking',case when b.id is null then null else to_jsonb(b) end);
  insert into interview_request_events values(p_operation,'line:'||who,r.id,'withdraw',payload,result,now());
  return result;
end;$$;

revoke all on function public.interview_parent_withdraw(text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.interview_parent_withdraw(text,uuid,uuid,integer) to service_role;

commit;
