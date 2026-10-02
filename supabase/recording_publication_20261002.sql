create table if not exists public.recording_publications (
 event_key text primary key,
 event_keys jsonb not null check(jsonb_typeof(event_keys)='array'),
 source_url text not null check(source_url like 'https://%'),
 source_urls jsonb not null check(jsonb_typeof(source_urls)='array'),
 lesson jsonb not null,
 mode text not null check(mode in ('private','scheduled','public')),
 release_at timestamptz,
 version integer not null default 1 check(version>0),
 updated_by uuid not null references public.staff_accounts(id),
 updated_at timestamptz not null default clock_timestamp(),
 check(mode <> 'scheduled' or release_at is not null)
);
create table if not exists public.recording_publication_audit (
 id bigint generated always as identity primary key,
 event_key text not null,
 before_data jsonb,
 after_data jsonb not null,
 staff_id uuid not null references public.staff_accounts(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.recording_publications enable row level security;
alter table public.recording_publication_audit enable row level security;
revoke all on public.recording_publications, public.recording_publication_audit from anon, authenticated;
grant all on public.recording_publications, public.recording_publication_audit to service_role;
grant usage, select on sequence public.recording_publication_audit_id_seq to service_role;
create or replace function public.save_recording_publication(p_key text,p_keys jsonb,p_url text,p_urls jsonb,p_lesson jsonb,p_mode text,p_release_at timestamptz,p_version integer,p_staff uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old_row recording_publications; new_row recording_publications;
begin
 if not exists(select 1 from staff_accounts where id=p_staff and active and role='admin') then raise exception 'permission denied' using errcode='42501'; end if;
 if p_mode not in ('private','scheduled','public') or (p_mode='scheduled' and (p_release_at is null or p_release_at <= clock_timestamp())) then raise exception 'invalid publication setting' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('recording:'||p_key,0));
 select * into old_row from recording_publications where event_key=p_key for update;
 if coalesce(old_row.version,0) <> p_version then raise exception 'publication changed' using errcode='40001'; end if;
 insert into recording_publications(event_key,event_keys,source_url,source_urls,lesson,mode,release_at,updated_by)
 values(p_key,p_keys,p_url,p_urls,p_lesson,p_mode,p_release_at,p_staff)
 on conflict(event_key) do update set event_keys=excluded.event_keys,mode=excluded.mode,release_at=excluded.release_at,
 source_urls=excluded.source_urls,source_url=excluded.source_url,lesson=excluded.lesson,version=recording_publications.version+1,updated_by=p_staff,updated_at=clock_timestamp()
 returning * into new_row;
 insert into recording_publication_audit(event_key,before_data,after_data,staff_id) values(p_key,case when old_row.event_key is null then null else to_jsonb(old_row) end,to_jsonb(new_row),p_staff);
 return to_jsonb(new_row);
end $$;
revoke all on function public.save_recording_publication(text,jsonb,text,jsonb,jsonb,text,timestamptz,integer,uuid) from public,anon,authenticated;
grant execute on function public.save_recording_publication(text,jsonb,text,jsonb,jsonb,text,timestamptz,integer,uuid) to service_role;
