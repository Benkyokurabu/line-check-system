-- Durable identity/uncertain-write handling for additive Notion availability.
-- Existing bookings and existing Notion pages are never updated by this worker.
begin;
create table if not exists public.individual_room_slots (
  slot_date date not null, start_time text not null check(start_time in ('16:45','18:35','20:25')),
  room text not null check(room in ('本①','本②','本③','本④','本⑥')),
  status text not null check(status in ('uncertain','created','existing')),
  notion_page_id uuid, source_sha256 text not null,
  run_id uuid not null references public.schedule_sync_runs(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(slot_date,start_time,room),
  check((status='uncertain' and notion_page_id is null) or (status<>'uncertain' and notion_page_id is not null))
);
create table if not exists public.individual_room_events (
  id bigint generated always as identity primary key,
  slot_date date not null,start_time text not null,room text not null,
  run_id uuid not null references public.schedule_sync_runs(id),
  event text not null check(event in ('claimed','created','existing')),
  notion_page_id uuid, created_at timestamptz not null default now()
);
alter table public.individual_room_slots enable row level security;
alter table public.individual_room_events enable row level security;
revoke all on public.individual_room_slots,public.individual_room_events from public,anon,authenticated;
grant select on public.individual_room_slots,public.individual_room_events to service_role;

create or replace function public.individual_room_sync_ready()
returns boolean language sql stable as $$select true$$;

create or replace function public.schedule_sync_renew(p_run uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.schedule_sync_control set lease_until=now()+interval '3 minutes'
    where id=true and enabled and run_id=p_run and lease_until>now()
    and exists(select 1 from public.schedule_sync_runs where id=p_run and status='running');
  return found;
end$$;

create or replace function public.individual_room_slot_claim(p_run uuid,p_date date,p_start text,p_room text,p_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.individual_room_slots%rowtype; acquired boolean;
begin
  perform 1 from public.schedule_sync_control where id=true and enabled and run_id=p_run and lease_until>now() for update;
  if not found then raise exception 'lease lost'; end if;
  perform 1 from public.schedule_sync_runs where id=p_run and status='running' and month=to_char(p_date,'YYYY-MM');
  if not found or p_date<(now() at time zone 'Asia/Tokyo')::date or length(p_hash)<>64 then raise exception 'invalid slot'; end if;
  insert into public.individual_room_slots(slot_date,start_time,room,status,source_sha256,run_id)
    values(p_date,p_start,p_room,'uncertain',p_hash,p_run) on conflict do nothing;
  acquired:=found;
  select * into r from public.individual_room_slots where slot_date=p_date and start_time=p_start and room=p_room;
  if acquired then insert into public.individual_room_events(slot_date,start_time,room,run_id,event) values(p_date,p_start,p_room,p_run,'claimed'); end if;
  return to_jsonb(r)||jsonb_build_object('acquired',acquired);
end$$;

create or replace function public.individual_room_slot_record(p_run uuid,p_date date,p_start text,p_room text,p_hash text,p_page uuid,p_status text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.schedule_sync_control where id=true and enabled and run_id=p_run and lease_until>now() for update;
  if not found then raise exception 'lease lost'; end if;
  perform 1 from public.schedule_sync_runs where id=p_run and status='running' and month=to_char(p_date,'YYYY-MM');
  if not found or p_status not in ('created','existing') or p_page is null or length(p_hash)<>64 then raise exception 'invalid record'; end if;
  insert into public.individual_room_slots(slot_date,start_time,room,status,notion_page_id,source_sha256,run_id)
    values(p_date,p_start,p_room,p_status,p_page,p_hash,p_run)
    on conflict(slot_date,start_time,room) do update set status=excluded.status,notion_page_id=excluded.notion_page_id,
      source_sha256=excluded.source_sha256,run_id=excluded.run_id,updated_at=now()
      where individual_room_slots.notion_page_id is null or individual_room_slots.notion_page_id=excluded.notion_page_id;
  if not found then raise exception 'slot already bound'; end if;
  insert into public.individual_room_events(slot_date,start_time,room,run_id,event,notion_page_id)
    values(p_date,p_start,p_room,p_run,p_status,p_page);
end$$;

revoke all on function public.individual_room_sync_ready(), public.schedule_sync_renew(uuid),
  public.individual_room_slot_claim(uuid,date,text,text,text),public.individual_room_slot_record(uuid,date,text,text,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.individual_room_sync_ready(), public.schedule_sync_renew(uuid),
  public.individual_room_slot_claim(uuid,date,text,text,text),public.individual_room_slot_record(uuid,date,text,text,text,uuid,text) to service_role;
commit;
notify pgrst,'reload schema';
