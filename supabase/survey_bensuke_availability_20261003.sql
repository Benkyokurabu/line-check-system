-- A shared page lock prevents the survey and the original booking workflow
-- from consuming the same Notion availability concurrently.
create table if not exists public.survey_bensuke_reservations (
 page_id uuid primary key,
 answer_id uuid not null references public.survey_bensuke_links(answer_id),
 created_at timestamptz not null default now()
);
alter table public.survey_bensuke_reservations enable row level security;
revoke all on public.survey_bensuke_reservations from public,anon,authenticated;
grant select on public.survey_bensuke_reservations to service_role;

create or replace function public.survey_bensuke_reserve(p_answer uuid,p_lease uuid,p_page uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_page::text,0));
 perform 1 from survey_bensuke_links where answer_id=p_answer and lease=p_lease and lease_until>clock_timestamp() for update;
 if not found then raise exception '保存の有効期限が切れました。再試行してください。' using errcode='PT409'; end if;
 if exists(select 1 from interview_bookings where notion_page_id=p_page)
  or exists(select 1 from survey_bensuke_links where page_id=p_page and answer_id<>p_answer)
  or exists(select 1 from survey_bensuke_reservations where page_id=p_page and answer_id<>p_answer) then
  raise exception 'この予約可は別の面談が使用しています。ベンスケを読み直してください。' using errcode='PT409';
 end if;
 insert into survey_bensuke_reservations(page_id,answer_id) values(p_page,p_answer) on conflict do nothing;
end $$;

create or replace function public.interview_survey_bensuke_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.notion_page_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(new.notion_page_id::text,0));
  if exists(select 1 from survey_bensuke_reservations where page_id=new.notion_page_id)
   or exists(select 1 from survey_bensuke_links where page_id=new.notion_page_id) then
   raise exception 'この予約可はアンケートの面談が使用しています。ベンスケを読み直してください。' using errcode='PT409';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists interview_survey_bensuke_guard on public.interview_bookings;
-- Alphabetical order runs this after interview_bensuke_guard sets page_id.
create trigger interview_survey_bensuke_guard before insert or update of notion_page_id on public.interview_bookings
 for each row execute function public.interview_survey_bensuke_guard();
revoke all on function public.survey_bensuke_reserve(uuid,uuid,uuid),public.interview_survey_bensuke_guard() from public,anon,authenticated;
grant execute on function public.survey_bensuke_reserve(uuid,uuid,uuid) to service_role;
