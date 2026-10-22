create table if not exists public.bentan_benkei_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 trial_only boolean not null default true, page_id text, last_sync_at timestamptz,
 sync_status text not null default 'not_started', sync_error text
);
insert into public.bentan_benkei_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.bentan_benkei_readers (
 id uuid primary key, display_name text not null, active boolean not null default true
);
create table if not exists public.bentan_benkei_reader_accounts (
 staff_id uuid primary key references public.staff_accounts(id), reader_id uuid not null references public.bentan_benkei_readers(id)
);
create table if not exists public.bentan_benkei_items (
 id uuid primary key default gen_random_uuid(), source_id text not null unique, title text not null,
 body text not null, source_url text not null, source_hash text not null,
 version integer not null default 1, source_edited_at timestamptz, active boolean not null default true,
 imported_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.bentan_benkei_versions (
 item_id uuid not null references public.bentan_benkei_items(id), version integer not null,
 title text not null, body text not null, source_hash text not null, recorded_at timestamptz not null default now(),
 primary key(item_id,version)
);
create table if not exists public.bentan_benkei_receipts (
 item_id uuid not null references public.bentan_benkei_items(id), version integer not null,
 reader_id uuid not null references public.bentan_benkei_readers(id),
 staff_id uuid not null references public.staff_accounts(id), confirmed_at timestamptz not null default clock_timestamp(),
 primary key(item_id,version,reader_id),
 foreign key(item_id,version) references public.bentan_benkei_versions(item_id,version)
);
create table if not exists public.bentan_benkei_dismissals (
 item_id uuid not null,version integer not null,reader_id uuid not null references public.bentan_benkei_readers(id),
 dismissed_at timestamptz not null default now(),primary key(item_id,version,reader_id),
 foreign key(item_id,version) references public.bentan_benkei_versions(item_id,version)
);
do $$ declare t text;begin
 foreach t in array array['settings','readers','reader_accounts','items','versions','receipts','dismissals'] loop
  execute format('alter table public.bentan_benkei_%I enable row level security',t);
  execute format('revoke all on public.bentan_benkei_%I from public,anon,authenticated',t);
  execute format('grant all on public.bentan_benkei_%I to service_role',t);
 end loop;
end $$;

create or replace function public.benkei_actor(p_auth_user_id uuid,p_auth_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;r uuid;c bentan_benkei_settings%rowtype;owner_reader uuid;
begin
 s:=public.staff_authorize(p_auth_user_id,p_auth_session_id);
 select * into c from bentan_benkei_settings where singleton;
 if not c.enabled then raise exception 'staff_permission_denied';end if;
 select reader_id into r from bentan_benkei_reader_accounts where staff_id=(s->>'staffId')::uuid;
 if r is null and (s->>'staffCode') like 'AVAIL_%' then
  select id into r from bentan_benkei_readers where replace(id::text,'-','')=lower(substr(s->>'staffCode',7)) and active;
 end if;
 select m.reader_id into owner_reader from bentan_benkei_reader_accounts m join staff_accounts a on a.id=m.staff_id where a.staff_code='KUDO';
 if r is null or not exists(select 1 from bentan_benkei_readers where id=r and active)
   or (c.trial_only and r is distinct from owner_reader) then raise exception 'staff_permission_denied';end if;
 return s||jsonb_build_object('readerId',r,'trialOnly',c.trial_only);
end $$;

create or replace function public.benkei_list(p_auth_user_id uuid,p_auth_session_id uuid,p_all boolean default false,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;rows jsonb;unread integer;more boolean;
begin
 s:=public.benkei_actor(p_auth_user_id,p_auth_session_id);
 if p_offset is null or p_offset<0 or p_offset>1000000 or p_all is null then raise exception 'invalid_request';end if;
 select count(*) into unread from bentan_benkei_items i where i.active and not exists(
  select 1 from bentan_benkei_receipts r where r.item_id=i.id and r.version=i.version and r.reader_id=(s->>'readerId')::uuid);
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into rows from (
  select i.*,exists(select 1 from bentan_benkei_receipts r where r.item_id=i.id and r.version=i.version and r.reader_id=(s->>'readerId')::uuid) confirmed,
   exists(select 1 from bentan_benkei_dismissals d where d.item_id=i.id and d.version=i.version and d.reader_id=(s->>'readerId')::uuid) dismissed,
   (select coalesce(jsonb_agg(jsonb_build_object('readerId',p.id,'name',p.display_name,'confirmedAt',r.confirmed_at,'version',r.version) order by p.display_name),'[]'::jsonb)
    from bentan_benkei_readers p left join bentan_benkei_receipts r on r.item_id=i.id and r.version=i.version and r.reader_id=p.id where p.active) readers,
   (select coalesce(jsonb_agg(jsonb_build_object('readerId',r.reader_id,'name',p.display_name,'confirmedAt',r.confirmed_at,'version',r.version) order by r.confirmed_at),'[]'::jsonb)
    from bentan_benkei_receipts r join bentan_benkei_readers p on p.id=r.reader_id where r.item_id=i.id) history
  from bentan_benkei_items i where i.active and (p_all or not exists(select 1 from bentan_benkei_dismissals r where r.item_id=i.id and r.version=i.version and r.reader_id=(s->>'readerId')::uuid))
  order by i.source_edited_at desc nulls last,i.id limit 20 offset p_offset
 ) q;
 select exists(select 1 from bentan_benkei_items i where i.active and (p_all or not exists(select 1 from bentan_benkei_dismissals r where r.item_id=i.id and r.version=i.version and r.reader_id=(s->>'readerId')::uuid)) offset p_offset+20 limit 1) into more;
 return jsonb_build_object('staff',s,'items',rows,'unreadCount',unread,'hasMore',more,'sync',(select to_jsonb(c)-'page_id' from bentan_benkei_settings c where singleton));
end $$;

create or replace function public.benkei_confirm(p_auth_user_id uuid,p_auth_session_id uuid,p_id uuid,p_version integer,p_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;i bentan_benkei_items%rowtype;
begin
 s:=public.benkei_actor(p_auth_user_id,p_auth_session_id);
 select * into i from bentan_benkei_items where id=p_id and active for update;
 if not found or i.version is distinct from p_version or i.source_hash is distinct from p_hash then raise exception 'benkei_conflict';end if;
 insert into bentan_benkei_receipts(item_id,version,reader_id,staff_id) values(i.id,i.version,(s->>'readerId')::uuid,(s->>'staffId')::uuid) on conflict do nothing;
 return jsonb_build_object('confirmed',true,'id',i.id,'version',i.version);
end $$;

create or replace function public.benkei_import(p_items jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare entry jsonb;i bentan_benkei_items%rowtype;n integer:=0;
begin
 perform pg_advisory_xact_lock(hashtext('benkei_import'));
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>200 then raise exception 'invalid_request';end if;
 for entry in select value from jsonb_array_elements(p_items) loop
  if length(coalesce(entry->>'sourceId',''))<1 or length(coalesce(entry->>'title',''))<1 or length(coalesce(entry->>'title',''))>160 or length(coalesce(entry->>'body','')) not between 1 and 300000 or coalesce(entry->>'hash','')!~'^[a-f0-9]{64}$'
    or coalesce(entry->>'url','')!~'^https://(www\.notion\.so|app\.notion\.com)/' then raise exception 'invalid_request';end if;
  select * into i from bentan_benkei_items where source_id=entry->>'sourceId' for update;
  if not found then
   insert into bentan_benkei_items(source_id,title,body,source_url,source_hash,source_edited_at)
   values(entry->>'sourceId',entry->>'title',entry->>'body',entry->>'url',entry->>'hash',(entry->>'editedAt')::timestamptz) returning * into i;
  elsif i.source_hash<>entry->>'hash' then
   update bentan_benkei_items set title=entry->>'title',body=entry->>'body',source_url=entry->>'url',source_hash=entry->>'hash',source_edited_at=(entry->>'editedAt')::timestamptz,version=version+1,active=true,updated_at=now() where id=i.id returning * into i;
  else
   update bentan_benkei_items set active=true,source_edited_at=(entry->>'editedAt')::timestamptz where id=i.id;
  end if;
  insert into bentan_benkei_versions(item_id,version,title,body,source_hash) values(i.id,i.version,i.title,i.body,i.source_hash) on conflict do nothing;
  n:=n+1;
 end loop;
 update bentan_benkei_settings set last_sync_at=now(),sync_status='ok',sync_error=null where singleton;
 return n;
end $$;
create or replace function public.benkei_complete_sync(p_items jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;begin
 n:=public.benkei_import(p_items);
 update bentan_benkei_items set active=false where active and source_id not in(select value->>'sourceId' from jsonb_array_elements(p_items));
 return n;
end $$;
revoke all on function public.benkei_complete_sync(jsonb) from public,anon,authenticated;
grant execute on function public.benkei_complete_sync(jsonb) to service_role;
revoke all on function public.benkei_actor(uuid,uuid),public.benkei_list(uuid,uuid,boolean,integer),public.benkei_confirm(uuid,uuid,uuid,integer,text),public.benkei_import(jsonb) from public,anon,authenticated;
grant execute on function public.benkei_actor(uuid,uuid),public.benkei_list(uuid,uuid,boolean,integer),public.benkei_confirm(uuid,uuid,uuid,integer,text),public.benkei_import(jsonb) to service_role;

create or replace function public.benkei_set_dismissed(p_auth_user_id uuid,p_auth_session_id uuid,p_ids uuid[],p_dismiss boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;i bentan_benkei_items%rowtype;n integer:=0;begin
 s:=public.benkei_actor(p_auth_user_id,p_auth_session_id);
 if p_ids is null or cardinality(p_ids) not between 1 and 100 or p_dismiss is null then raise exception 'invalid_request';end if;
 for i in select * from bentan_benkei_items where id=any(p_ids) and active order by id for update loop
  if p_dismiss and not exists(select 1 from bentan_benkei_receipts r where r.item_id=i.id and r.version=i.version and r.reader_id=(s->>'readerId')::uuid) then raise exception 'benkei_conflict';end if;
  if p_dismiss then
   insert into bentan_benkei_dismissals(item_id,version,reader_id) values(i.id,i.version,(s->>'readerId')::uuid) on conflict do nothing;
  else
   delete from bentan_benkei_dismissals where item_id=i.id and version=i.version and reader_id=(s->>'readerId')::uuid;
  end if;
  n:=n+1;
 end loop;
 if n<>(select count(distinct value) from unnest(p_ids) value) then raise exception 'invalid_request';end if;
 return jsonb_build_object('changed',n,'dismissed',p_dismiss);
end $$;
revoke all on function public.benkei_set_dismissed(uuid,uuid,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.benkei_set_dismissed(uuid,uuid,uuid[],boolean) to service_role;
