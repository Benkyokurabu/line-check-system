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
  student_number text references public.student_roster (student_number) on delete set null,
  event_type text not null default 'absence',
  event_date date,
  lesson_id uuid references public.lessons (id) on delete set null,
  suggested_subject text,
  suggested_class_name text,
  ai_summary text,
  arrival_expected_time text,
  note_internal text,
  note_for_classroom text,
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

alter table public.attendance_candidate_items
  add column if not exists student_number text references public.student_roster (student_number) on delete set null,
  add column if not exists arrival_expected_time text,
  add column if not exists note_internal text,
  add column if not exists note_for_classroom text;

do $$
begin
  alter table public.attendance_candidates
    drop constraint if exists attendance_candidates_event_type_check;
  alter table public.attendance_candidates
    add constraint attendance_candidates_event_type_check
    check (event_type in ('absence', 'late', 'early_leave', 'reschedule_request', 'other'));

  alter table public.attendance_candidate_items
    drop constraint if exists attendance_candidate_items_event_type_check;
  alter table public.attendance_candidate_items
    add constraint attendance_candidate_items_event_type_check
    check (event_type in ('absence', 'late', 'early_leave', 'reschedule_request', 'other'));
end $$;
create index if not exists attendance_candidate_items_candidate_idx
  on public.attendance_candidate_items (candidate_id, event_date, created_at);
create index if not exists attendance_candidate_items_status_idx
  on public.attendance_candidate_items (status, event_date, created_at desc);
create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  source_candidate_id uuid references public.attendance_candidates (id) on delete set null,
  source_message_id uuid references public.line_messages (id) on delete set null,
  source_candidate_item_id uuid references public.attendance_candidate_items (id) on delete set null,
  contact_method text not null default 'line',
  contact_received_at timestamptz,
  received_by text,
  student_number text not null references public.student_roster (student_number) on delete restrict,
  lesson_id uuid not null references public.lessons (id) on delete restrict,
  event_date date not null,
  event_type text not null,
  reason text,
  arrival_expected_time text,
  note_internal text,
  note_for_classroom text,
  status text not null default 'confirmed',
  confirmed_by text,
  confirmed_at timestamptz not null default now(),
  cancelled_by text,
  cancelled_at timestamptz,
  notion_page_id text,
  notion_status text not null default 'not_requested',
  notion_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_events_contact_method_check
    check (contact_method in ('line', 'phone', 'oral', 'other')),
  constraint attendance_events_event_type_check
    check (event_type in ('absence', 'late', 'early_leave')),
  constraint attendance_events_status_check
    check (status in ('confirmed', 'cancelled')),
  constraint attendance_events_notion_status_check
    check (notion_status in ('not_requested', 'pending', 'success', 'failed')),
  constraint attendance_events_student_lesson_unique
    unique (student_number, lesson_id)
);

create index if not exists attendance_events_lesson_status_idx
  on public.attendance_events (lesson_id, status, event_date);
create index if not exists attendance_events_student_date_idx
  on public.attendance_events (student_number, event_date desc);
create index if not exists attendance_events_source_candidate_idx
  on public.attendance_events (source_candidate_id);

create table if not exists public.attendance_event_audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.attendance_events (id) on delete cascade,
  action text not null,
  actor text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attendance_event_audit_logs_event_idx
  on public.attendance_event_audit_logs (event_id, created_at desc);

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
  if not exists (
    select 1 from pg_trigger where tgname = 'set_attendance_candidate_items_updated_at'
      and tgrelid = 'public.attendance_candidate_items'::regclass
  ) then
    create trigger set_attendance_candidate_items_updated_at before update on public.attendance_candidate_items
      for each row execute function public.set_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'set_attendance_events_updated_at'
      and tgrelid = 'public.attendance_events'::regclass
  ) then
    create trigger set_attendance_events_updated_at before update on public.attendance_events
      for each row execute function public.set_updated_at();
  end if;
end $$;

