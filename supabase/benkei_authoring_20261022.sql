-- Separate authoring outbox; no existing source or staff settings are changed.
create table if not exists public.bentan_benkei_authoring_operations(
 id uuid primary key,creator_id uuid not null references public.staff_accounts(id),
 kind text not null check(kind in('create','edit')),payload jsonb not null,request_hash text not null,desired_hash text not null,
 source_id text,status text not null default 'pending' check(status in('pending','writing','unknown','synced','conflict','blocked')),
 lease uuid,lease_until timestamptz,error_code text,result jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists bentan_benkei_authoring_unknown_duplicate_idx on public.bentan_benkei_authoring_operations(creator_id,request_hash) where status in('pending','writing','unknown');
create table if not exists public.bentan_benkei_authoring_sources(
 source_id text primary key,create_operation uuid not null references public.bentan_benkei_authoring_operations(id),
 current_operation uuid not null references public.bentan_benkei_authoring_operations(id),
 creator_id uuid not null references public.staff_accounts(id),updated_at timestamptz not null default now()
);
alter table public.bentan_benkei_authoring_operations enable row level security;
alter table public.bentan_benkei_authoring_sources enable row level security;
revoke all on public.bentan_benkei_authoring_operations,public.bentan_benkei_authoring_sources from public,anon,authenticated;
grant all on public.bentan_benkei_authoring_operations,public.bentan_benkei_authoring_sources to service_role;

create or replace function public.benkei_authoring_actor(p_user uuid,p_session uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor jsonb;
begin
 actor:=public.benkei_actor(p_user,p_session);
 if actor->>'staffCode' is distinct from 'KUDO' then raise exception 'staff_permission_denied';end if;
 return (actor->>'staffId')::uuid;
end;$$;

create or replace function public.benkei_authoring_read(p_user uuid,p_session uuid,p_operation uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid;entries jsonb;operations jsonb;operation jsonb;
begin
 actor:=public.benkei_authoring_actor(p_user,p_session);
 if p_operation is not null then
  select to_jsonb(o) into operation from bentan_benkei_authoring_operations o where id=p_operation and creator_id=actor;
  return jsonb_build_object('operation',operation);
 end if;
 select coalesce(jsonb_agg(to_jsonb(i)),'[]') into entries from (
  select i.source_id,i.title,i.body,i.source_hash,i.source_url,i.updated_at from bentan_benkei_authoring_sources s join bentan_benkei_items i on i.source_id=s.source_id
  where s.creator_id=actor and i.active order by i.updated_at desc limit 100
 )i;
 select coalesce(jsonb_agg(to_jsonb(o)),'[]') into operations from (
  select * from bentan_benkei_authoring_operations where creator_id=actor order by created_at desc limit 30
 )o;
 return jsonb_build_object('entries',entries,'operations',operations);
end;$$;

create or replace function public.benkei_authoring_prepare(p_user uuid,p_session uuid,p_id uuid,p_kind text,p_payload jsonb,p_hash text,p_desired_hash text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid;o bentan_benkei_authoring_operations%rowtype;other_id uuid;
begin
 actor:=public.benkei_authoring_actor(p_user,p_session);
 if p_id is null or p_kind is null or p_kind not in('create','edit') or jsonb_typeof(p_payload)<>'object' or length(coalesce(p_payload->>'title','')) not between 1 and 160 or length(coalesce(p_payload->>'body','')) not between 1 and 190000 or coalesce(p_hash,'')!~'^[a-f0-9]{64}$' or coalesce(p_desired_hash,'')!~'^[a-f0-9]{64}$' then raise exception 'invalid_request';end if;
 perform pg_advisory_xact_lock(hashtext('benkei_authoring_prepare'));
 select * into o from bentan_benkei_authoring_operations where id=p_id for update;
 if found then
  if o.creator_id<>actor or o.request_hash<>p_hash or o.kind<>p_kind or o.payload<>p_payload or o.desired_hash<>p_desired_hash then raise exception 'authoring_idempotency_conflict';end if;
  return to_jsonb(o);
 end if;
 select id into other_id from bentan_benkei_authoring_operations where creator_id=actor and request_hash=p_hash and status in('pending','writing','unknown');
 if found then raise exception 'authoring_unknown_operation';end if;
 if p_kind='edit' then
  if not exists(select 1 from bentan_benkei_authoring_sources where source_id=p_payload->>'sourceId' and creator_id=actor) then raise exception 'authoring_source_not_owned';end if;
  if coalesce(p_payload->>'expectedHash','')!~'^[a-f0-9]{64}$' then raise exception 'invalid_request';end if;
  if exists(select 1 from bentan_benkei_authoring_operations where source_id=p_payload->>'sourceId' and status in('pending','writing','unknown')) then raise exception 'authoring_unknown_operation';end if;
 end if;
 insert into bentan_benkei_authoring_operations(id,creator_id,kind,payload,request_hash,desired_hash,source_id)
 values(p_id,actor,p_kind,p_payload,p_hash,p_desired_hash,case when p_kind='edit' then p_payload->>'sourceId' else null end) returning * into o;
 return to_jsonb(o);
end;$$;

create or replace function public.benkei_authoring_claim(p_id uuid,p_recover_only boolean default false) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o bentan_benkei_authoring_operations%rowtype;prior_status text;v_lease uuid:=gen_random_uuid();
begin
 select * into o from bentan_benkei_authoring_operations where id=p_id for update;
 if not found or o.status in('synced','conflict','blocked') or (o.lease_until is not null and o.lease_until>now()) or (p_recover_only and o.status='pending') then return null;end if;
 prior_status:=o.status;
 update bentan_benkei_authoring_operations set status=case when status='pending' then 'writing' else status end,lease=v_lease,lease_until=now()+interval '2 minutes',updated_at=now() where id=p_id returning * into o;
 return jsonb_build_object('operation',to_jsonb(o),'lease',v_lease,'mode',case when prior_status='pending' then 'write' else 'recover' end);
end;$$;

create or replace function public.benkei_authoring_finish(p_id uuid,p_lease uuid,p_status text,p_source text default null,p_item jsonb default null,p_error text default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o bentan_benkei_authoring_operations%rowtype;
begin
 select * into o from bentan_benkei_authoring_operations where id=p_id for update;
 if not found or o.lease is distinct from p_lease then raise exception 'authoring_lease_conflict';end if;
 if p_status is null or p_status not in('unknown','synced','conflict','blocked') then raise exception 'invalid_request';end if;
 if p_status='synced' then
  if p_source is null or p_item is null or p_item->>'sourceId' is distinct from p_source or p_item->>'hash' is distinct from o.desired_hash then raise exception 'invalid_request';end if;
  if o.kind='edit' and p_source is distinct from o.source_id then raise exception 'invalid_request';end if;
  perform public.benkei_import(jsonb_build_array(p_item));
  insert into bentan_benkei_authoring_sources(source_id,create_operation,current_operation,creator_id)
  values(p_source,o.id,o.id,o.creator_id) on conflict(source_id) do update set current_operation=excluded.current_operation,updated_at=now();
 end if;
 update bentan_benkei_authoring_operations set status=p_status,source_id=coalesce(p_source,source_id),error_code=p_error,result=case when p_item is null then result else p_item end,lease=null,lease_until=null,updated_at=now() where id=p_id returning * into o;
 return to_jsonb(o);
end;$$;

revoke all on function public.benkei_authoring_actor(uuid,uuid),public.benkei_authoring_read(uuid,uuid,uuid),public.benkei_authoring_prepare(uuid,uuid,uuid,text,jsonb,text,text),public.benkei_authoring_claim(uuid,boolean),public.benkei_authoring_finish(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.benkei_authoring_actor(uuid,uuid),public.benkei_authoring_read(uuid,uuid,uuid),public.benkei_authoring_prepare(uuid,uuid,uuid,text,jsonb,text,text),public.benkei_authoring_claim(uuid,boolean),public.benkei_authoring_finish(uuid,uuid,text,text,jsonb,text) to service_role;
