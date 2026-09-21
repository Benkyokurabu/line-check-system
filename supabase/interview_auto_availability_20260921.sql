-- Mirror Notion availability without inventing a staff actor or changing reservations.
alter table public.interview_public_slots alter column updated_by drop not null;
alter table public.interview_public_slots add column if not exists source_available boolean not null default true;
alter table public.interview_public_slots add column if not exists source_checked_at timestamptz;

create or replace function public.interview_refresh_slots(p_teachers text[],p_offers jsonb,p_checked timestamptz)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare offer jsonb;
begin
 if p_checked is null or p_checked>clock_timestamp()+interval '1 minute' or jsonb_typeof(p_offers) is distinct from 'array'
   or coalesce(cardinality(p_teachers),0)=0 then raise exception 'invalid_slot_refresh';end if;
 perform 1 from interview_settings where id for update;
 for offer in select value from jsonb_array_elements(p_offers) loop
  if offer->'data'->>'method' is distinct from 'Zoom'
   or nullif(offer->>'editedAt','') is null
   or not (interview_teacher_key(offer->'data'->>'teacher')=any(p_teachers))
   or nullif(offer->'data'->>'teacher','') is null then raise exception 'invalid_slot_refresh';end if;
  insert into interview_public_slots(notion_page_id,data,notion_edited_at,source_available,source_checked_at)
  values((offer->>'pageId')::uuid,offer->'data',offer->>'editedAt',true,p_checked)
  on conflict(notion_page_id) do update set
   data=excluded.data,notion_edited_at=excluded.notion_edited_at,source_available=true,source_checked_at=p_checked,
   version=interview_public_slots.version+case when interview_public_slots.data is distinct from excluded.data
    or interview_public_slots.notion_edited_at is distinct from excluded.notion_edited_at
    or not interview_public_slots.source_available then 1 else 0 end,
   updated_at=now()
  where interview_public_slots.source_checked_at is null or interview_public_slots.source_checked_at<=p_checked;
 end loop;
 update interview_public_slots s set source_available=false,source_checked_at=p_checked,
  version=s.version+case when s.source_available then 1 else 0 end,updated_at=now()
 where interview_teacher_key(s.data->>'teacher')=any(p_teachers)
  and (s.source_checked_at is null or s.source_checked_at<=p_checked)
  and not exists(select 1 from jsonb_array_elements(p_offers) o where (o->>'pageId')::uuid=s.notion_page_id);
end;$$;

create or replace function public.interview_slot_available(p_slot uuid,p_teacher text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from interview_public_slots s where s.id=p_slot and s.published and s.source_available
 and nullif(interview_teacher_key(p_teacher),'') is not null
 and s.data->>'method'='Zoom' and interview_teacher_key(s.data->>'teacher')=interview_teacher_key(p_teacher)
 and (s.data->>'date')::date between (now() at time zone 'Asia/Tokyo')::date+1 and (now() at time zone 'Asia/Tokyo')::date+60
 and not exists(select 1 from interview_bookings b where b.notion_page_id=s.notion_page_id
   or (b.status not in ('cancelled','rejected') and b.data->>'date'=s.data->>'date'
     and interview_teacher_key(b.data->>'teacher')=interview_teacher_key(s.data->>'teacher')
     and b.data->>'busyStart'<s.data->>'busyEnd' and s.data->>'busyStart'<b.data->>'busyEnd')));
$$;
revoke all on function public.interview_refresh_slots(text[],jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.interview_refresh_slots(text[],jsonb,timestamptz) to service_role;
notify pgrst,'reload schema';
