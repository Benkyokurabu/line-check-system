-- A staff decision applies to this message only, never to every message from a shared LINE account.
alter table public.attendance_candidates
  add column if not exists human_reviewed_at timestamptz,
  add column if not exists human_reviewed_by text;

create table if not exists public.attendance_candidate_review_audit (
  id bigint generated always as identity primary key,
  candidate_id uuid not null references public.attendance_candidates(id) on delete cascade,
  actor text,
  before_student_number text,
  after_student_number text,
  before_lessons jsonb not null,
  after_lessons jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_candidate_review_audit_candidate_idx
  on public.attendance_candidate_review_audit(candidate_id, created_at desc);

create or replace function public.save_attendance_candidate_review(
  p_candidate_id uuid,
  p_candidate jsonb,
  p_items jsonb,
  p_actor text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  before_student text;
  after_student text;
  before_lessons jsonb;
  after_lessons jsonb;
  was_reviewed boolean;
  saved_id uuid;
begin
  select student_number, human_reviewed_at is not null
    into before_student, was_reviewed
  from public.attendance_candidates where id = p_candidate_id for update;
  if not found then
    raise exception '候補が見つかりません' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'student_number', student_number, 'event_date', event_date, 'lesson_id', lesson_id
  ) order by student_number, event_date, lesson_id), '[]'::jsonb)
    into before_lessons
  from public.attendance_candidate_items
  where candidate_id = p_candidate_id and status in ('pending', 'notion_failed');

  saved_id := public.replace_attendance_candidate_draft(p_candidate_id, p_candidate, p_items);
  update public.attendance_candidates
    set human_reviewed_at = now(),
        human_reviewed_by = coalesce(nullif(btrim(p_actor), ''), human_reviewed_by)
    where id = p_candidate_id
    returning student_number into after_student;
  select coalesce(jsonb_agg(jsonb_build_object(
    'student_number', student_number, 'event_date', event_date, 'lesson_id', lesson_id
  ) order by student_number, event_date, lesson_id), '[]'::jsonb)
    into after_lessons
  from public.attendance_candidate_items
  where candidate_id = p_candidate_id and status in ('pending', 'notion_failed');
  if not was_reviewed or before_student is distinct from after_student or before_lessons is distinct from after_lessons then
    insert into public.attendance_candidate_review_audit
      (candidate_id, actor, before_student_number, after_student_number, before_lessons, after_lessons)
    values (p_candidate_id, nullif(btrim(p_actor), ''), before_student, after_student, before_lessons, after_lessons);
  end if;
  return saved_id;
end
$$;

revoke all on table public.attendance_candidate_review_audit from public, anon, authenticated;
revoke all on function public.save_attendance_candidate_review(uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_attendance_candidate_review(uuid, jsonb, jsonb, text) to service_role;
