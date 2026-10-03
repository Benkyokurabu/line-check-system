alter table public.recording_publications add column if not exists notion_page_id text;
alter table public.recording_publications add column if not exists automatic boolean not null default false;
alter table public.recording_publications drop constraint if exists recording_publications_mode_check;
alter table public.recording_publications add constraint recording_publications_mode_check check(mode in ('private','scheduled','public','notion'));
alter table public.recording_publications add constraint recording_publications_notion_check check(mode<>'notion' or notion_page_id is not null or automatic);
drop function public.save_recording_publication(text,jsonb,text,jsonb,jsonb,text,timestamptz,integer,uuid);
create or replace function public.save_recording_publication(p_key text,p_keys jsonb,p_url text,p_urls jsonb,p_lesson jsonb,p_mode text,p_release_at timestamptz,p_version integer,p_staff uuid,p_notion_page_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old_row recording_publications; new_row recording_publications;
begin
 if not exists(select 1 from staff_accounts where id=p_staff and active and role='admin') then raise exception 'permission denied' using errcode='42501'; end if;
 if p_mode not in ('private','scheduled','public','notion') or (p_mode='scheduled' and (p_release_at is null or p_release_at <= clock_timestamp())) then raise exception 'invalid publication setting' using errcode='22023'; end if;
 if p_mode='notion' and (p_notion_page_id is null or p_notion_page_id !~* '^[0-9a-f-]{36}$') then raise exception 'invalid Notion page' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('recording:'||p_key,0));
 select * into old_row from recording_publications where event_key=p_key for update;
 if coalesce(old_row.version,0) <> p_version then raise exception 'publication changed' using errcode='PT409'; end if;
 insert into recording_publications(event_key,event_keys,source_url,source_urls,lesson,mode,release_at,updated_by,notion_page_id)
 values(p_key,p_keys,p_url,p_urls,p_lesson,p_mode,p_release_at,p_staff,case when p_mode='notion' then p_notion_page_id else null end)
 on conflict(event_key) do update set event_keys=excluded.event_keys,mode=excluded.mode,release_at=excluded.release_at,notion_page_id=excluded.notion_page_id,automatic=false,
 source_urls=excluded.source_urls,source_url=excluded.source_url,lesson=excluded.lesson,version=recording_publications.version+1,updated_by=p_staff,updated_at=clock_timestamp()
 returning * into new_row;
 insert into recording_publication_audit(event_key,before_data,after_data,staff_id) values(p_key,case when old_row.event_key is null then null else to_jsonb(old_row) end,to_jsonb(new_row),p_staff);
 return to_jsonb(new_row);
end $$;
revoke all on function public.save_recording_publication(text,jsonb,text,jsonb,jsonb,text,timestamptz,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.save_recording_publication(text,jsonb,text,jsonb,jsonb,text,timestamptz,integer,uuid,text) to service_role;

create or replace function public.capture_test_recording(p_key text,p_url text,p_lesson jsonb,p_notion_page_id text)
returns void language plpgsql security definer set search_path=public as $$
declare owner uuid;
begin
 if p_url not like 'https://%' then raise exception 'invalid URL' using errcode='22023'; end if;
 select id into owner from staff_accounts where staff_code='KUDO' and role='admin' and active;
 if owner is null then raise exception 'recording administrator missing'; end if;
 perform pg_advisory_xact_lock(hashtextextended('recording:'||p_key,0));
 insert into recording_publications(event_key,event_keys,source_url,source_urls,lesson,mode,updated_by,notion_page_id,automatic)
 values(p_key,jsonb_build_array(p_key),p_url,jsonb_build_array(p_url),p_lesson,'notion',owner,p_notion_page_id,true)
 on conflict(event_key) do update set source_urls=(select jsonb_agg(distinct u) from jsonb_array_elements(recording_publications.source_urls||excluded.source_urls) u),
 source_url=case when recording_publications.automatic then excluded.source_url else recording_publications.source_url end,
 notion_page_id=case when recording_publications.automatic then coalesce(excluded.notion_page_id,recording_publications.notion_page_id) else recording_publications.notion_page_id end;
end $$;
revoke all on function public.capture_test_recording(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.capture_test_recording(text,text,jsonb,text) to service_role;
