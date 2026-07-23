create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  lesson_date date not null,
  start_time text,
  grade text,
  class_name text,
  subject text,
  campus text,
  classroom text,
  teacher_name text,
  label text not null,
  source_key text not null unique,
  source_file text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lessons_date_idx on public.lessons (lesson_date, start_time);
create index if not exists lessons_class_idx on public.lessons (grade, subject, class_name);

create table if not exists public.attendance_message_reviews (
  message_id uuid primary key references public.line_messages (id) on delete cascade,
  result text not null,
  error_message text,
  processed_at timestamptz not null default now(),
  constraint attendance_message_reviews_result_check
    check (result in ('candidate', 'ignored', 'failed'))
);

create table if not exists public.attendance_candidates (
  id uuid primary key default gen_random_uuid(),
  source_message_id uuid not null references public.line_messages (id) on delete restrict,
  student_number text references public.student_roster (student_number) on delete set null,
  suggested_student_name text,
  event_type text not null default 'absence',
  event_date date,
  lesson_id uuid references public.lessons (id) on delete set null,
  suggested_subject text,
  suggested_class_name text,
  ai_summary text,
  ai_confidence numeric,
  ai_reason text,
  status text not null default 'pending',
  confirmed_by text,
  confirmed_at timestamptz,
  notion_page_id text,
  notion_error text,
  raw_ai_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_candidates_event_type_check
    check (event_type in ('absence', 'late', 'reschedule_request', 'other')),
  constraint attendance_candidates_status_check
    check (status in ('pending', 'registering', 'confirmed', 'notion_failed', 'dismissed')),
  constraint attendance_candidates_confidence_check
    check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  constraint attendance_candidates_message_student_unique
    unique (source_message_id, student_number, event_type, event_date)
);

create index if not exists attendance_candidates_status_idx
  on public.attendance_candidates (status, event_date, created_at desc);
create index if not exists attendance_candidates_student_idx
  on public.attendance_candidates (student_number, event_date desc);

create table if not exists public.attendance_candidate_items (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.attendance_candidates (id) on delete cascade,
  event_type text not null default 'absence',
  event_date date,
  lesson_id uuid references public.lessons (id) on delete set null,
  suggested_subject text,
  suggested_class_name text,
  ai_summary text,
  status text not null default 'pending',
  notion_page_id text,
  notion_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_candidate_items_event_type_check
    check (event_type in ('absence', 'late', 'reschedule_request', 'other')),
  constraint attendance_candidate_items_status_check
    check (status in ('pending', 'confirmed', 'notion_failed', 'dismissed'))
);

create index if not exists attendance_candidate_items_candidate_idx
  on public.attendance_candidate_items (candidate_id, event_date, created_at);
create index if not exists attendance_candidate_items_status_idx
  on public.attendance_candidate_items (status, event_date, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_lessons_updated_at'
      and tgrelid = 'public.lessons'::regclass
  ) then
    create trigger set_lessons_updated_at before update on public.lessons
      for each row execute function public.set_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'set_attendance_candidates_updated_at'
      and tgrelid = 'public.attendance_candidates'::regclass
  ) then
    create trigger set_attendance_candidates_updated_at before update on public.attendance_candidates
      for each row execute function public.set_updated_at();
  end if;
end $$;

