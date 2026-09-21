-- Possession of a private link grants access to one pilot invitation, never staff access.
create table public.interview_invitation_access (
 token_hash text primary key, invitation_id uuid not null references interview_invitations(id) deferrable initially deferred,
 expires_at timestamptz not null default now()+interval '90 days', created_at timestamptz not null default now()
);
alter table interview_invitation_access enable row level security;
revoke all on interview_invitation_access from public,anon,authenticated;
grant all on interview_invitation_access to service_role;

create function public.interview_invitation_access_create(p_invitation uuid) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare token text;
begin
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into interview_invitation_access(token_hash,invitation_id) values(encode(sha256(convert_to(token,'UTF8')),'hex'),p_invitation);
 return 'https://line-check-system.vercel.app/interviews/trial?invitation='||p_invitation::text||'#access='||token;
end;$$;

create function public.interview_invitation_access_check(p_hash text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',i.id,'studentId',i.student_id) from interview_invitation_access a
 join interview_invitations i on i.id=a.invitation_id
 where a.token_hash=p_hash and a.expires_at>now() and i.status<>'revoked'
 and interview_invitation_identity(i.student_id,i.recipient);
$$;

create or replace function public.interview_notification_link() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation uuid; link text;
begin
 if tg_table_name='interview_invitations' then
  invitation:=new.id;
  new.message:=replace(new.message,'LINE下部の「面談予約」から希望時間をお選びください。','以下のリンクから希望時間をお選びください。');
 else
  select invitation_id into invitation from interview_parent_requests where id=new.request_id;
  new.message:=replace(new.message,'確定内容はLINE下部の「面談予約」から確認できます。','以下のリンクから確定内容を確認できます。');
 end if;
 if invitation is null then link:='https://line-check-system.vercel.app/interviews/trial';
 else link:=interview_invitation_access_create(invitation);end if;
 new.message:=new.message||E'\n'||link;
 return new;
end;$$;

create function public.interview_invitation_access_decline(p_hash text,p_operation uuid,p_id uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare subject jsonb;i interview_invitations%rowtype;e interview_invitation_events%rowtype;payload jsonb;result jsonb;
begin
 perform 1 from interview_settings where id for update;
 subject:=interview_invitation_access_check(p_hash);
 if subject is null or subject->>'id' is distinct from p_id::text then raise exception 'parent_subject_denied';end if;
 payload:=jsonb_build_object('action','link_decline','id',p_id,'version',p_version);
 select * into e from interview_invitation_events where operation_key=p_operation;
 if found then
  if e.actor<>(subject->>'studentId')::uuid or e.payload<>payload then raise exception 'idempotency_conflict';end if;
  return e.result;
 end if;
 select * into i from interview_invitations where id=p_id for update;
 if i.version is distinct from p_version or i.status<>'active' then raise exception 'version_conflict';end if;
 if exists(select 1 from interview_parent_requests q join interview_bookings b on b.id=q.booking_id where q.invitation_id=i.id and q.status='approved' and b.status='confirmed') then raise exception 'request_already_active';end if;
 if i.lease_until>now() then raise exception 'notification_in_progress';end if;
 update interview_invitations set status='declined',version=version+1 where id=i.id returning * into i;
 update interview_parent_requests set status='rejected',reason='案内の日程を見直します。教室からの再案内をお待ちください。',version=version+1,updated_at=now() where invitation_id=i.id and status='pending';
 result:=jsonb_build_object('id',i.id,'status',i.status,'version',i.version);
 insert into interview_invitation_events(operation_key,actor,payload,result) values(p_operation,(subject->>'studentId')::uuid,payload,result);
 return result;
end;$$;
revoke all on function interview_invitation_access_create(uuid),interview_invitation_access_check(text),interview_invitation_access_decline(text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function interview_invitation_access_create(uuid),interview_invitation_access_check(text),interview_invitation_access_decline(text,uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
