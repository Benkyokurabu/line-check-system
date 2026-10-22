-- Additive private source snapshots. Does not modify Notion, LINE or staff settings.
create table if not exists public.school_context_sources(
 source_key text primary key,source_type text not null check(source_type in('notion','line')),
 native_id text not null,metadata jsonb not null default '{}',pending boolean not null default true,
 status text not null default 'discovered',last_version text,updated_at timestamptz not null default now()
);
create table if not exists public.school_context_records(
 id uuid primary key default gen_random_uuid(),source_key text not null references public.school_context_sources(source_key),
 version text not null,title text not null,content text not null,source_ref text not null default '',
 occurred_at timestamptz,fetched_at timestamptz not null,source_type text not null,direction text,
 associations jsonb not null default '[]',raw jsonb not null,coverage jsonb not null,
 unique(source_key,version)
);
create index if not exists school_context_records_source_idx on school_context_records(source_key,fetched_at desc);
create table if not exists public.school_context_coverage(
 id uuid primary key default gen_random_uuid(),channel text not null,scope text not null,status text not null,
 detail jsonb not null default '{}',created_at timestamptz not null default now()
);
create index if not exists school_context_coverage_channel_idx on school_context_coverage(channel,created_at desc);
create table if not exists public.school_context_state(key text primary key,value jsonb not null,updated_at timestamptz not null default now());
create table if not exists public.school_context_proposals(
 id uuid primary key default gen_random_uuid(),fingerprint text not null unique,rule text not null,
 title text not null,description text not null,evidence jsonb not null,coverage jsonb not null,
 status text not null default 'pending' check(status in('pending','accepted','held','dismissed')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.school_context_decisions(
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null references public.school_context_proposals(id),
 actor_id uuid not null references public.staff_accounts(id),decision text not null check(decision in('accepted','held','dismissed')),
 reason text not null default '',created_at timestamptz not null default now()
);
alter table public.school_context_sources enable row level security;
alter table public.school_context_records enable row level security;
alter table public.school_context_coverage enable row level security;
alter table public.school_context_state enable row level security;
alter table public.school_context_proposals enable row level security;
alter table public.school_context_decisions enable row level security;
revoke all on public.school_context_sources,public.school_context_records,public.school_context_coverage,public.school_context_state,public.school_context_proposals,public.school_context_decisions from public,anon,authenticated;
grant all on public.school_context_sources,public.school_context_records,public.school_context_coverage,public.school_context_state,public.school_context_proposals,public.school_context_decisions to service_role;

create or replace function public.school_context_require(p_user uuid,p_session uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;
begin
 s:=public.staff_authorize(p_user,p_session);
 if not exists(select 1 from staff_accounts where id=(s->>'staffId')::uuid and active and staff_code='KUDO' and role in('admin','office','employee')) then raise exception 'staff_permission_denied';end if;
 return (s->>'staffId')::uuid;
end;$$;

create or replace function public.school_context_ingest(p_record jsonb,p_proposal jsonb default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid;
begin
 if p_record->>'sourceKey' is null or p_record->>'version' is null or p_record->>'sourceType' not in('notion','line') then raise exception 'invalid_context_record';end if;
 insert into school_context_sources(source_key,source_type,native_id,metadata,pending,status,last_version)
 values(p_record->>'sourceKey',p_record->>'sourceType',p_record->>'nativeId','{}',p_record->>'sourceType'='notion' and not coalesce((p_record#>>'{coverage,complete}')::boolean,false),'available',p_record->>'version')
 on conflict(source_key) do update set
 last_version=case when excluded.source_type='notion' and excluded.pending and exists(select 1 from school_context_records r where r.source_key=excluded.source_key and r.version=school_context_sources.last_version and (r.coverage->>'complete')::boolean) then school_context_sources.last_version else excluded.last_version end,
 pending=case when excluded.source_type='line' then false else excluded.pending end,
 status=case when excluded.source_type='notion' and excluded.pending and school_context_sources.last_version is not null then 'refreshing' else 'available' end,updated_at=now();
 insert into school_context_records(source_key,version,title,content,source_ref,occurred_at,fetched_at,source_type,direction,associations,raw,coverage)
 values(p_record->>'sourceKey',p_record->>'version',coalesce(p_record->>'title',''),coalesce(p_record->>'text',''),coalesce(p_record->>'sourceRef',''),nullif(p_record->>'occurredAt','')::timestamptz,(p_record->>'fetchedAt')::timestamptz,p_record->>'sourceType',p_record->>'direction',coalesce(p_record->'associations','[]'),p_record->'raw',p_record->'coverage')
 on conflict(source_key,version) do nothing returning id into rid;
 if rid is null then select id into rid from school_context_records where source_key=p_record->>'sourceKey' and version=p_record->>'version';end if;
 if p_proposal is not null then
  insert into school_context_proposals(fingerprint,rule,title,description,evidence,coverage)
  values(p_proposal->>'fingerprint',p_proposal->>'rule',p_proposal->>'title',p_proposal->>'description',p_proposal->'evidence',p_proposal->'coverage')
  on conflict(fingerprint) do nothing;
 end if;
 return rid;
end;$$;

create or replace function public.school_context_read(p_user uuid,p_session uuid,p_view text default 'summary',p_query text default '',p_student text default '',p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare records jsonb:='[]';proposals jsonb:='[]';coverage jsonb:='[]';lim integer;
begin
 perform public.school_context_require(p_user,p_session);
 if p_view not in('summary','list','search','proposals','coverage') or p_limit is null or p_limit<1 or p_limit>100 or length(p_query)>200 or length(p_student)>100 then raise exception 'invalid_context_query';end if;
 lim:=case when p_view='summary' then least(p_limit,5) else p_limit end;
 select coalesce(jsonb_agg(to_jsonb(c)),'[]') into coverage from (
  select distinct on(channel,scope) channel,scope,status,detail,created_at from school_context_coverage order by channel,scope,created_at desc,id desc
 )c;
 if p_view in('summary','list','search') then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into records from (
   select r.id,r.source_key,r.version,r.title,r.content,r.source_ref,r.occurred_at,r.fetched_at,r.source_type,r.direction,r.associations,r.coverage,s.status source_status
   from school_context_records r join school_context_sources s on s.source_key=r.source_key and s.last_version=r.version
   where (p_query='' or position(lower(p_query) in lower(r.title||' '||r.content))>0)
    and (p_student='' or exists(select 1 from jsonb_array_elements(r.associations)a where a->>'id'=p_student and a->>'verifiedStudent'='true'))
   order by r.fetched_at desc,r.id desc limit lim
  )r;
 end if;
 if p_view in('summary','proposals') then
  select coalesce(jsonb_agg(to_jsonb(p)),'[]') into proposals from (
   select p.*,coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) from school_context_decisions d where d.proposal_id=p.id),'[]') decisions,
    exists(select 1 from jsonb_array_elements(p.evidence)e join school_context_sources s on s.source_key=e->>'sourceKey' where s.last_version<>e->>'version' or s.status<>'available') evidence_stale
   from school_context_proposals p where (p_view='proposals' or p.status='pending') order by p.created_at desc,p.id desc limit lim
  )p;
 end if;
 return jsonb_build_object('records',records,'proposals',proposals,'coverage',coverage,'summary',jsonb_build_object('recordCount',(select count(*) from school_context_sources where last_version is not null),'proposalCount',(select count(*) from school_context_proposals where status='pending'),'pendingSources',(select count(*) from school_context_sources where pending)));
end;$$;

create or replace function public.school_context_decide(p_user uuid,p_session uuid,p_proposal uuid,p_decision text,p_reason text default '') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid;prior text;
begin
 actor:=public.school_context_require(p_user,p_session);
 if p_decision is null or p_decision not in('accepted','held','dismissed') or p_reason is null or length(p_reason)>2000 then raise exception 'invalid_context_decision';end if;
 select status into prior from school_context_proposals where id=p_proposal for update;
 if not found then raise exception 'context_proposal_not_found';end if;
 if prior<>p_decision then
  update school_context_proposals set status=p_decision,updated_at=now() where id=p_proposal;
  insert into school_context_decisions(proposal_id,actor_id,decision,reason) values(p_proposal,actor,p_decision,p_reason);
 end if;
 return jsonb_build_object('id',p_proposal,'status',p_decision);
end;$$;

revoke all on function public.school_context_require(uuid,uuid),public.school_context_ingest(jsonb,jsonb),public.school_context_read(uuid,uuid,text,text,text,integer),public.school_context_decide(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.school_context_require(uuid,uuid),public.school_context_ingest(jsonb,jsonb),public.school_context_read(uuid,uuid,text,text,text,integer),public.school_context_decide(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.school_context_sync_claim() returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare lease uuid:=gen_random_uuid();claimed text;
begin
 insert into school_context_state(key,value) values('sync_lease',jsonb_build_object('lease',lease,'until',clock_timestamp()+interval '10 minutes'))
 on conflict(key) do update set value=excluded.value,updated_at=now()
 where (school_context_state.value->>'until')::timestamptz<clock_timestamp()
 returning key into claimed;
 if claimed is null then return null;end if;return lease;
end;$$;
create or replace function public.school_context_sync_release(p_lease uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin delete from school_context_state where key='sync_lease' and value->>'lease'=p_lease::text;return found;end;$$;
revoke all on function public.school_context_sync_claim(),public.school_context_sync_release(uuid) from public,anon,authenticated;
grant execute on function public.school_context_sync_claim(),public.school_context_sync_release(uuid) to service_role;

create or replace function public.school_context_ingest_batch(p_records jsonb) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb;n integer:=0;
begin
 if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>1000 then raise exception 'invalid_context_batch';end if;
 for item in select * from jsonb_array_elements(p_records) loop
  perform school_context_ingest(item->'record',nullif(item->'proposal','null'::jsonb));n:=n+1;
 end loop;return n;
end;$$;
revoke all on function public.school_context_ingest_batch(jsonb) from public,anon,authenticated;
grant execute on function public.school_context_ingest_batch(jsonb) to service_role;

create or replace function public.school_context_discovery_finish(p_cycle text) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 if p_cycle is null or length(p_cycle)>100 then raise exception 'invalid_context_cycle';end if;
 -- Absence from search is not deletion: retain history and verify the source itself.
 update school_context_sources set pending=true,status='needs_verification'
 where source_type='notion' and (metadata->>'discoveryCycleAt') is distinct from p_cycle;
 get diagnostics n=row_count;return n;
end;$$;
revoke all on function public.school_context_discovery_finish(text) from public,anon,authenticated;
grant execute on function public.school_context_discovery_finish(text) to service_role;
