-- Additive: retain all submissions and the existing reader grant.
alter table public.bentan_feedback add column if not exists reviewed_at timestamptz;
create index if not exists bentan_feedback_unreviewed_idx on public.bentan_feedback(created_at desc,id desc) where reviewed_at is null;

create table if not exists public.bentan_feedback_notification_config (
 singleton boolean primary key default true check(singleton),
 staff_id uuid not null references public.staff_accounts(id),
 recipient text not null check(recipient~'^U[0-9a-f]{32}$'),
 enabled boolean not null default false
);
create table if not exists public.bentan_feedback_notifications (
 feedback_id uuid primary key references public.bentan_feedback(id) on delete cascade,
 retry_key uuid not null unique default gen_random_uuid(),
 recipient text, message text,
 status text not null default 'pending' check(status in ('pending','sending','retry','sent','blocked')),
 lease uuid,lease_until timestamptz,first_attempt_at timestamptz,next_attempt_at timestamptz,
 attempts integer not null default 0,line_request_id text,error text,sent_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.bentan_feedback_notification_config enable row level security;
alter table public.bentan_feedback_notifications enable row level security;
revoke all on public.bentan_feedback_notification_config,public.bentan_feedback_notifications from public,anon,authenticated;
grant all on public.bentan_feedback_notification_config,public.bentan_feedback_notifications to service_role;

create or replace function public.feedback_require_reader(p_auth_user_id uuid,p_auth_session_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;
begin
 s:=public.staff_authorize(p_auth_user_id,p_auth_session_id);
 if not exists(select 1 from bentan_feedback_reader r join staff_accounts a on a.id=r.staff_id
   where r.singleton and r.staff_id=(s->>'staffId')::uuid and a.active and a.staff_code='KUDO')
 then raise exception 'staff_permission_denied';end if;
 return (s->>'staffId')::uuid;
end;$$;

create or replace function public.feedback_inbox_summary(p_auth_user_id uuid,p_auth_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.feedback_require_reader(p_auth_user_id,p_auth_session_id);
 return jsonb_build_object('unreviewedCount',(select count(*) from bentan_feedback where reviewed_at is null),
  'total',(select count(*) from bentan_feedback),
  'notificationPending',(select count(*) from bentan_feedback_notifications where status in ('pending','sending','retry')),
  'notificationBlocked',(select count(*) from bentan_feedback_notifications where status='blocked'));
end;$$;

create or replace function public.get_bentan_feedback_inbox(p_auth_user_id uuid,p_auth_session_id uuid,p_offset integer default 0,p_unreviewed_only boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare rows jsonb;more boolean;
begin
 perform public.feedback_require_reader(p_auth_user_id,p_auth_session_id);
 if p_offset is null or p_offset<0 or p_offset>1000000 or p_unreviewed_only is null then raise exception 'invalid_feedback';end if;
 select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) into rows from (
  select f.id,f.sender_name,f.message,f.created_at,f.sharing_preference,f.reviewed_at,n.status as notification_status
   from bentan_feedback f left join bentan_feedback_notifications n on n.feedback_id=f.id
   where not p_unreviewed_only or f.reviewed_at is null
   order by f.created_at desc,f.id desc limit 50 offset p_offset
 ) f;
 select exists(select 1 from bentan_feedback where not p_unreviewed_only or reviewed_at is null offset p_offset+50 limit 1) into more;
 return public.feedback_inbox_summary(p_auth_user_id,p_auth_session_id)||jsonb_build_object('feedback',rows,'hasMore',more);
end;$$;

create or replace function public.list_bentan_feedback(p_auth_user_id uuid,p_auth_session_id uuid,p_offset integer default 0)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select public.get_bentan_feedback_inbox(p_auth_user_id,p_auth_session_id,p_offset,false);
$$;

create or replace function public.review_bentan_feedback(p_auth_user_id uuid,p_auth_session_id uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.feedback_require_reader(p_auth_user_id,p_auth_session_id);
 update bentan_feedback set reviewed_at=coalesce(reviewed_at,clock_timestamp()) where id=p_id;
 if not found then raise exception 'invalid_feedback';end if;
 return public.feedback_inbox_summary(p_auth_user_id,p_auth_session_id);
end;$$;

create or replace function public.feedback_enqueue_notification() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into bentan_feedback_notifications(feedback_id) values(new.id) on conflict do nothing;
 return new;
end;$$;
drop trigger if exists feedback_enqueue_notification on public.bentan_feedback;
create trigger feedback_enqueue_notification after insert on public.bentan_feedback for each row execute function public.feedback_enqueue_notification();
-- Intentionally do not enqueue historical submissions.

create or replace function public.feedback_notification_claim(p_feedback uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c bentan_feedback_notification_config%rowtype;n bentan_feedback_notifications%rowtype;
begin
 select cfg.* into c from bentan_feedback_notification_config cfg
  join staff_accounts a on a.id=cfg.staff_id
  join bentan_feedback_reader r on r.staff_id=a.id and r.singleton
  where cfg.singleton and cfg.enabled and a.active and a.staff_code='KUDO';
 if not found then return null;end if;
 select * into n from bentan_feedback_notifications
  where status in ('pending','retry','sending') and (p_feedback is null or feedback_id=p_feedback)
   and (lease_until is null or lease_until<=now()) and (next_attempt_at is null or next_attempt_at<=now())
  order by created_at,feedback_id limit 1 for update skip locked;
 if not found then return null;end if;
 if (n.recipient is not null and n.recipient<>c.recipient) or n.first_attempt_at<now()-interval '23 hours' then
  update bentan_feedback_notifications set status='blocked',error='recipient_changed_or_retry_expired',lease=null,lease_until=null where feedback_id=n.feedback_id;
  return null;
 end if;
 update bentan_feedback_notifications set status='sending',recipient=c.recipient,
  message=E'【勉たん】改善のご意見が届きました。\n工藤専用の確認画面で内容をご確認ください。\nhttps://line-check-system.vercel.app/private-feedback',
  lease=gen_random_uuid(),lease_until=now()+interval '60 seconds',first_attempt_at=coalesce(first_attempt_at,now()),
  next_attempt_at=null,attempts=attempts+1 where feedback_id=n.feedback_id returning * into n;
 return jsonb_build_object('feedback_id',n.feedback_id,'recipient',n.recipient,'message',n.message,'retry_key',n.retry_key,'lease',n.lease);
end;$$;

create or replace function public.feedback_notification_finish(p_feedback uuid,p_lease uuid,p_result text,p_request_id text,p_error text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n bentan_feedback_notifications%rowtype;
begin
 select * into n from bentan_feedback_notifications where feedback_id=p_feedback and lease=p_lease and status='sending' for update;
 if not found then return false;end if;
 if p_result is null or p_result not in ('sent','retry','blocked') then raise exception 'invalid_notification_result';end if;
 if p_result='sent' then
  insert into line_messages(line_message_id,line_user_id,direction,message_type,text,sent_by,received_at,raw_event)
  values('feedback_notification_'||n.retry_key,n.recipient,'outbound','text',n.message,'改善要望の通知',now(),
   jsonb_build_object('send_context','bentan_feedback_notification','feedback_id',n.feedback_id,'retry_key',n.retry_key,'line_request_id',p_request_id))
  on conflict(line_message_id) do nothing;
 end if;
 update bentan_feedback_notifications set status=p_result,lease=null,lease_until=null,
  line_request_id=p_request_id,error=left(p_error,500),sent_at=case when p_result='sent' then now() else sent_at end,
  next_attempt_at=case when p_result='retry' then now()+interval '60 seconds' else null end
  where feedback_id=p_feedback;
 return true;
end;$$;

revoke all on function public.feedback_require_reader(uuid,uuid),public.feedback_inbox_summary(uuid,uuid),
 public.get_bentan_feedback_inbox(uuid,uuid,integer,boolean),public.list_bentan_feedback(uuid,uuid,integer),public.review_bentan_feedback(uuid,uuid,uuid),
 public.feedback_enqueue_notification(),public.feedback_notification_claim(uuid),public.feedback_notification_finish(uuid,uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function public.feedback_require_reader(uuid,uuid),public.feedback_inbox_summary(uuid,uuid),
 public.get_bentan_feedback_inbox(uuid,uuid,integer,boolean),public.list_bentan_feedback(uuid,uuid,integer),public.review_bentan_feedback(uuid,uuid,uuid),
 public.feedback_notification_claim(uuid),public.feedback_notification_finish(uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
