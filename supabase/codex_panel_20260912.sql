-- Private durable queue. Only the authenticated configured owner can use the API.
create table if not exists public.bentan_codex_owner (
  singleton boolean primary key default true check(singleton),
  staff_id uuid not null references public.staff_accounts(id)
);
create table if not exists public.bentan_codex_conversations (
  id uuid primary key, staff_id uuid not null references public.staff_accounts(id),
  codex_thread_id text, created_at timestamptz not null default now()
);
create table if not exists public.bentan_codex_requests (
  id uuid primary key, conversation_id uuid not null references public.bentan_codex_conversations(id),
  staff_id uuid not null references public.staff_accounts(id),
  message text not null check(length(message) between 1 and 2000), page_context jsonb not null,
  status text not null default 'queued' check(status in ('queued','running','awaiting_approval','completed','failed','cancelled')),
  response text not null default '', progress text not null default '受付済み',
  approval jsonb, approval_decision text check(approval_decision in ('accept','decline')),
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists bentan_codex_requests_order on public.bentan_codex_requests(created_at,id);
create table if not exists public.bentan_codex_worker (
  singleton boolean primary key default true check(singleton), worker_id uuid not null,
  heartbeat_at timestamptz not null default now(), ready boolean not null default false
);
alter table public.bentan_codex_owner enable row level security;
alter table public.bentan_codex_conversations enable row level security;
alter table public.bentan_codex_requests enable row level security;
alter table public.bentan_codex_worker enable row level security;
revoke all on public.bentan_codex_owner,public.bentan_codex_conversations,public.bentan_codex_requests,public.bentan_codex_worker from public,anon,authenticated;
grant all on public.bentan_codex_owner,public.bentan_codex_conversations,public.bentan_codex_requests,public.bentan_codex_worker to service_role;

create or replace function public.bentan_codex_action(p_auth_user_id uuid,p_auth_session_id uuid,p_action text,p_body jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare staff jsonb; sid uuid; cid uuid; rid uuid; prior public.bentan_codex_requests%rowtype; rows jsonb;
begin
  staff := public.staff_authorize(p_auth_user_id,p_auth_session_id);
  sid := (staff->>'staffId')::uuid;
  if not exists(select 1 from bentan_codex_owner where singleton and staff_id=sid) then raise exception 'staff_permission_denied'; end if;
  if p_action='status' then
    return jsonb_build_object('authorized',true,'online',exists(select 1 from bentan_codex_worker where ready and heartbeat_at>now()-interval '30 seconds'));
  end if;
  cid := (p_body->>'conversationId')::uuid;
  if cid is null then raise exception 'invalid_request'; end if;
  if exists(select 1 from bentan_codex_conversations where id=cid and staff_id<>sid) then raise exception 'staff_permission_denied'; end if;
  if p_action='list' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]') into rows from (
      select id,message,page_context,status,response,progress,approval,cancel_requested,created_at from bentan_codex_requests
      where conversation_id=cid and staff_id=sid order by created_at desc,id desc limit 50
    ) r;
    return jsonb_build_object('requests',rows,'online',exists(select 1 from bentan_codex_worker where ready and heartbeat_at>now()-interval '30 seconds'));
  end if;
  rid := (p_body->>'id')::uuid;
  if rid is null then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(sid::text, 912));
  if p_action='send' then
    if length(btrim(p_body->>'message')) not between 1 and 2000 or p_body->>'message' is null
      or jsonb_typeof(p_body->'context') is distinct from 'object' or octet_length((p_body->'context')::text)>6500 then raise exception 'invalid_request'; end if;
    select * into prior from bentan_codex_requests where id=rid;
    if found then
      if prior.staff_id<>sid or prior.conversation_id<>cid or prior.message<>p_body->>'message' or prior.page_context<>p_body->'context' then raise exception 'request_conflict'; end if;
      return jsonb_build_object('accepted',true);
    end if;
    if exists(select 1 from bentan_codex_requests where conversation_id=cid and status in ('queued','running','awaiting_approval')) then raise exception 'request_busy'; end if;
    if (select count(*) from bentan_codex_requests where staff_id=sid and created_at>now()-interval '1 hour')>=60 then raise exception 'request_limit'; end if;
    insert into bentan_codex_conversations(id,staff_id) values(cid,sid) on conflict do nothing;
    insert into bentan_codex_requests(id,conversation_id,staff_id,message,page_context) values(rid,cid,sid,p_body->>'message',p_body->'context');
  elsif p_action='cancel' then
    update bentan_codex_requests set cancel_requested=true,status=case when status='queued' then 'cancelled' else status end,updated_at=now()
      where id=rid and conversation_id=cid and staff_id=sid and status in ('queued','running','awaiting_approval');
  elsif p_action='approve' then
    if p_body->>'decision' not in ('accept','decline') or p_body->>'decision' is null then raise exception 'invalid_request'; end if;
    update bentan_codex_requests set approval_decision=p_body->>'decision',updated_at=now()
      where id=rid and conversation_id=cid and staff_id=sid and status='awaiting_approval'
      and approval->>'id'=p_body->>'approvalId' and approval_decision is null and not cancel_requested;
    if not found then raise exception 'request_conflict'; end if;
  else raise exception 'invalid_request'; end if;
  return jsonb_build_object('accepted',true);
end; $$;

-- Global worker lease prevents a second PC/process from executing the same request.
create or replace function public.bentan_codex_tick(p_worker_id uuid,p_ready boolean default true)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(91212026);
  if exists(select 1 from bentan_codex_worker where worker_id<>p_worker_id and heartbeat_at>now()-interval '30 seconds') then return false; end if;
  if not exists(select 1 from bentan_codex_worker where worker_id=p_worker_id and heartbeat_at>now()-interval '30 seconds') then
    update bentan_codex_requests set status='failed',approval=null,progress='PCとの接続が切れました。変更状況を確認してから再依頼してください。',updated_at=now() where status in ('running','awaiting_approval');
  end if;
  insert into bentan_codex_worker(singleton,worker_id,ready) values(true,p_worker_id,p_ready)
    on conflict(singleton) do update set worker_id=excluded.worker_id,ready=excluded.ready,heartbeat_at=now();
  return true;
end; $$;
create or replace function public.bentan_codex_claim(p_worker_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.bentan_codex_requests%rowtype;
begin
  perform pg_advisory_xact_lock(91212026);
  if not exists(select 1 from bentan_codex_worker where worker_id=p_worker_id and ready and heartbeat_at>now()-interval '30 seconds') then return null; end if;
  if exists(select 1 from bentan_codex_requests where status in ('running','awaiting_approval')) then return null; end if;
  select r.* into job from bentan_codex_requests r join bentan_codex_owner o on o.staff_id=r.staff_id
    join staff_accounts a on a.id=r.staff_id and a.active
    where r.status='queued' and not r.cancel_requested order by r.created_at,r.id for update of r skip locked limit 1;
  if not found then return null; end if;
  update bentan_codex_requests set status='running',progress='Codexが依頼を確認しています',updated_at=now() where id=job.id;
  return to_jsonb(job);
end; $$;
revoke all on function public.bentan_codex_action(uuid,uuid,text,jsonb),public.bentan_codex_tick(uuid,boolean),public.bentan_codex_claim(uuid) from public,anon,authenticated;
grant execute on function public.bentan_codex_action(uuid,uuid,text,jsonb),public.bentan_codex_tick(uuid,boolean),public.bentan_codex_claim(uuid) to service_role;

create or replace function public.bentan_codex_update(p_worker_id uuid,p_id uuid,p_patch jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(91212026);
  if not exists(select 1 from bentan_codex_worker where worker_id=p_worker_id and ready and heartbeat_at>now()-interval '30 seconds') then return false; end if;
  update bentan_codex_requests set
    status=coalesce(p_patch->>'status',status),response=coalesce(p_patch->>'response',response),progress=coalesce(p_patch->>'progress',progress),
    approval=case when p_patch ? 'approval' then nullif(p_patch->'approval','null'::jsonb) else approval end,
    approval_decision=case when p_patch ? 'approval_decision' then p_patch->>'approval_decision' else approval_decision end,updated_at=now()
  where id=p_id and status in ('running','awaiting_approval');
  return found;
end; $$;
revoke all on function public.bentan_codex_update(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bentan_codex_update(uuid,uuid,jsonb) to service_role;
