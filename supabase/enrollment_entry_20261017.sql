create table if not exists public.enrollment_entries (
 id uuid primary key,
 student_page_id uuid not null,
 actor_id uuid not null references public.staff_accounts(id),
 version integer not null default 1,
 payload jsonb not null,
 targets jsonb not null default '{}'::jsonb,
 status text not null default 'queued' check(status in ('queued','running','partial','review','complete')),
 lease uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists enrollment_entries_queue on public.enrollment_entries(status,next_attempt_at);
create index if not exists enrollment_entries_student on public.enrollment_entries(student_page_id,created_at desc);
create unique index if not exists enrollment_entries_one_student on public.enrollment_entries(student_page_id);
create table if not exists public.enrollment_entry_events (
 operation_key uuid primary key,
 entry_id uuid not null references public.enrollment_entries(id),
 actor_id uuid not null references public.staff_accounts(id),
 request_hash text not null,
 version integer not null,
 before_payload jsonb,
 after_payload jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.enrollment_entries enable row level security;
alter table public.enrollment_entry_events enable row level security;
revoke all on public.enrollment_entries,public.enrollment_entry_events from public,anon,authenticated;
grant select,insert,update on public.enrollment_entries,public.enrollment_entry_events to service_role;

create or replace function public.enrollment_entry_save(p_user uuid,p_session uuid,p_operation uuid,p_id uuid,p_version integer,p_payload jsonb,p_targets jsonb,p_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a jsonb; previous public.enrollment_entries%rowtype; event public.enrollment_entry_events%rowtype; result public.enrollment_entries%rowtype;
begin
 a:=public.staff_authorize(p_user,p_session,null,false);
 if coalesce(a->>'staffCode','') not in ('KUDO','KINJO') or coalesce(a->>'role','') not in ('admin','office','employee') then raise exception 'staff_permission_denied';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_payload->>'studentPageId',1));
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into event from enrollment_entry_events where operation_key=p_operation;
 if found then
  if event.entry_id<>p_id or event.actor_id<>(a->>'staffId')::uuid or event.request_hash<>p_hash then raise exception 'enrollment_conflict';end if;
  return jsonb_build_object('id',event.entry_id,'version',event.version,'replayed',true);
 end if;
 if jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>150000 or length(p_hash)<>64 or p_payload->>'studentPageId' is null then raise exception 'enrollment_invalid';end if;
 select * into previous from enrollment_entries where id=p_id for update;
 if found then
  if previous.version<>p_version or previous.student_page_id<>(p_payload->>'studentPageId')::uuid or previous.lease_until>now() then raise exception 'enrollment_conflict';end if;
  update enrollment_entries set payload=p_payload,targets=p_targets,version=version+1,actor_id=(a->>'staffId')::uuid,status='queued',lease=null,lease_until=null,next_attempt_at=now(),updated_at=now() where id=p_id returning * into result;
 else
  if p_version<>0 then raise exception 'enrollment_conflict';end if;
  if exists(select 1 from enrollment_entries where student_page_id=(p_payload->>'studentPageId')::uuid)then raise exception 'enrollment_conflict';end if;
  insert into enrollment_entries(id,student_page_id,actor_id,payload,targets)values(p_id,(p_payload->>'studentPageId')::uuid,(a->>'staffId')::uuid,p_payload,p_targets) returning * into result;
 end if;
 insert into enrollment_entry_events(operation_key,entry_id,actor_id,request_hash,version,before_payload,after_payload) values(p_operation,p_id,(a->>'staffId')::uuid,p_hash,result.version,previous.payload,p_payload);
 return jsonb_build_object('id',result.id,'version',result.version,'replayed',false);
end $$;

create or replace function public.enrollment_entry_claim(p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare row public.enrollment_entries%rowtype;
begin
 select e.* into row from enrollment_entries e join staff_accounts a on a.id=e.actor_id and a.active and a.staff_code in ('KUDO','KINJO') and a.role in ('admin','office','employee')
 where (p_id is null or e.id=p_id) and (e.status in ('queued','partial') or (e.status='running' and e.lease_until<now()))
 and e.next_attempt_at<=now() and (e.lease_until is null or e.lease_until<now()) order by e.updated_at for update of e skip locked limit 1;
 if not found then return null;end if;
 update enrollment_entries set status='running',lease=gen_random_uuid(),lease_until=now()+interval '120 seconds',updated_at=now() where id=row.id returning * into row;
 return to_jsonb(row);
end $$;

create or replace function public.enrollment_entry_checkpoint(p_id uuid,p_lease uuid,p_targets jsonb,p_status text default 'running')
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_status not in ('running','partial','review','complete') or jsonb_typeof(p_targets)<>'object' then raise exception 'enrollment_invalid';end if;
 update enrollment_entries set targets=p_targets,status=p_status,lease=case when p_status='running' then lease else null end,
 lease_until=case when p_status='running' then now()+interval '120 seconds' else null end,
 next_attempt_at=case when p_status='partial' then now()+interval '1 minute' else next_attempt_at end,updated_at=now()
 where id=p_id and lease=p_lease and status='running' and lease_until>now();
 return found;
end $$;
revoke all on function public.enrollment_entry_save(uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text),public.enrollment_entry_claim(uuid),public.enrollment_entry_checkpoint(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.enrollment_entry_save(uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text),public.enrollment_entry_claim(uuid),public.enrollment_entry_checkpoint(uuid,uuid,jsonb,text) to service_role;
