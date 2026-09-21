create table if not exists public.interview_pilot_notification_config (
 id boolean primary key default true check(id),
 staff_id uuid not null references public.staff_accounts(id),
 student_number text not null default '2018999' check(student_number='2018999'),
 recipient text not null check(recipient~'^U[0-9a-f]{32}$'),
 enabled boolean not null default false
);
create table if not exists public.interview_pilot_notifications (
 booking_id uuid primary key references public.interview_bookings(id),
 request_id uuid not null references public.interview_parent_requests(id),
 booking_version integer not null,
 recipient text not null,
 message text not null,
 retry_key uuid not null unique default gen_random_uuid(),
 status text not null default 'pending' check(status in ('pending','sending','retry','sent','blocked','obsolete')),
 first_attempt_at timestamptz, next_attempt_at timestamptz, lease uuid, lease_until timestamptz,
 attempts integer not null default 0,line_request_id text,error text,sent_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.interview_pilot_notification_config enable row level security;
alter table public.interview_pilot_notifications enable row level security;
revoke all on public.interview_pilot_notification_config,public.interview_pilot_notifications from public,anon,authenticated;
grant all on public.interview_pilot_notification_config,public.interview_pilot_notifications to service_role;

create or replace function public.interview_pilot_enqueue() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare c interview_pilot_notification_config%rowtype;b interview_bookings%rowtype;
begin
 if new.status<>'approved' or new.line_user_id<>'BENTAN-KUDO-INTERVIEW-LIVE-PREVIEW' then return new;end if;
 select cfg.* into c from interview_pilot_notification_config cfg join staff_accounts a on a.id=cfg.staff_id
 where cfg.id and cfg.enabled and a.staff_code='KUDO' and a.active
 and exists(select 1 from student_registry r join student_line_accounts l using(student_number)
 where r.student_number='2018999' and r.interview_student_id=new.student_id and l.line_user_id=cfg.recipient
 and l.relation='student' and l.verification_status='confirmed');
 if not found then return new;end if;
 select * into b from interview_bookings where id=new.booking_id and student_id=new.student_id and status='confirmed';
 if not found then return new;end if;
 insert into interview_pilot_notifications(booking_id,request_id,booking_version,recipient,message)
 values(b.id,new.id,b.version,c.recipient,
  E'【工藤専用・動作確認】\n面談予約が確定しました。\n検証用 工藤\n日時：'||(b.data->>'date')||' '||(b.data->>'start')||'〜'||(b.data->>'end')||
  E'\n担当：'||(b.data->>'teacher')||E'先生\nオンライン面談\nこれは検証用で、実際の面談ではありません。\n確定内容はLINE下部の「面談予約」から確認できます。')
 on conflict(booking_id) do nothing;
 return new;
end;$$;
drop trigger if exists interview_pilot_enqueue on public.interview_parent_requests;
create trigger interview_pilot_enqueue after insert or update of status on public.interview_parent_requests
 for each row execute function public.interview_pilot_enqueue();

create or replace function public.interview_pilot_notification_claim(p_booking uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n interview_pilot_notifications%rowtype;b interview_bookings%rowtype;
begin
 select * into n from interview_pilot_notifications where booking_id=p_booking for update skip locked;
 if not found or n.status in ('sent','blocked','obsolete') then return null;end if;
 if n.lease_until>now() or n.next_attempt_at>now() then return null;end if;
 if not exists(select 1 from interview_pilot_notification_config c join staff_accounts a on a.id=c.staff_id
 join student_registry r on r.student_number=c.student_number
 join student_line_accounts l on l.student_number=r.student_number and l.line_user_id=c.recipient
 join interview_parent_requests q on q.id=n.request_id and q.student_id=r.interview_student_id
 where c.id and c.enabled and c.recipient=n.recipient and c.student_number='2018999'
 and a.staff_code='KUDO' and a.active and l.relation='student' and l.verification_status='confirmed'
 and q.line_user_id='BENTAN-KUDO-INTERVIEW-LIVE-PREVIEW' and q.status='approved' and q.booking_id=n.booking_id)
 then update interview_pilot_notifications set status='blocked',error='pilot_identity_changed' where booking_id=p_booking;return null;end if;
 select * into b from interview_bookings where id=p_booking;
 if b.status<>'confirmed' or b.version<>n.booking_version then
  update interview_pilot_notifications set status='obsolete',error='booking_changed' where booking_id=p_booking;return null;end if;
 if b.notion_synced_version<>b.version or b.sync_error is not null then return null;end if;
 if n.first_attempt_at<now()-interval '23 hours' then
  update interview_pilot_notifications set status='blocked',error='retry_window_expired' where booking_id=p_booking;return null;end if;
 update interview_pilot_notifications set status='sending',lease=gen_random_uuid(),lease_until=now()+interval '60 seconds',
 first_attempt_at=coalesce(first_attempt_at,now()),next_attempt_at=null,attempts=attempts+1 where booking_id=p_booking returning * into n;
 return to_jsonb(n);
end;$$;

create or replace function public.interview_pilot_notification_finish(p_booking uuid,p_lease uuid,p_result text,p_request_id text,p_error text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n interview_pilot_notifications%rowtype;
begin
 select * into n from interview_pilot_notifications where booking_id=p_booking and lease=p_lease and status='sending' for update;
 if not found then return false;end if;
 if p_result not in ('sent','retry','blocked') then raise exception 'invalid_notification_result';end if;
 if p_result='sent' then
  insert into line_messages(line_message_id,line_user_id,direction,message_type,text,sent_by,received_at,raw_event)
  values('interview_pilot_'||n.retry_key,n.recipient,'outbound','text',n.message,'面談予約・工藤検証',now(),
   jsonb_build_object('send_context','interview_kudo_pilot','booking_id',n.booking_id,'retry_key',n.retry_key,'line_request_id',p_request_id))
  on conflict(line_message_id) do nothing;
 end if;
 update interview_pilot_notifications set status=p_result,lease=null,lease_until=null,
 line_request_id=p_request_id,error=left(p_error,500),sent_at=case when p_result='sent' then now() else sent_at end,
 next_attempt_at=case when p_result='retry' then now()+interval '30 seconds' else null end where booking_id=p_booking;
 return true;
end;$$;
revoke all on function public.interview_pilot_enqueue(),public.interview_pilot_notification_claim(uuid),public.interview_pilot_notification_finish(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.interview_pilot_notification_claim(uuid),public.interview_pilot_notification_finish(uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
