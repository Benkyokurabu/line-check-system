create table if not exists public.notion_sync_mappings (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_kind text not null,
  notion_data_source_id text,
  target_table text not null,
  property_map jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notion_sync_mappings_source_kind_check
    check (source_kind in ('student', 'staff', 'survey', 'interaction', 'reservation', 'class_excel'))
);

create unique index if not exists notion_sync_mappings_source_name_idx
  on public.notion_sync_mappings (source_name);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_kind text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  scanned_count integer not null default 0,
  upserted_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint sync_runs_status_check check (status in ('running', 'success', 'failed', 'partial'))
);

create index if not exists sync_runs_source_started_idx
  on public.sync_runs (source_name, started_at desc);

create table if not exists public.student_interactions (
  id uuid primary key default gen_random_uuid(),
  notion_page_id text unique,
  student_number text references public.student_roster (student_number) on delete set null,
  notion_student_page_id text,
  title text not null,
  interaction_date timestamptz,
  method text,
  purposes text[] not null default '{}',
  staff_name text,
  grade_at_time text,
  campus text,
  body text,
  attachment_count integer not null default 0,
  raw_notion jsonb,
  notion_last_edited_time timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_interactions_student_number_idx
  on public.student_interactions (student_number, interaction_date desc);

create index if not exists student_interactions_notion_student_page_idx
  on public.student_interactions (notion_student_page_id);

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  notion_page_id text unique,
  notion_data_source_id text,
  source_name text not null,
  student_number text references public.student_roster (student_number) on delete set null,
  notion_student_page_id text,
  raw_student_name text,
  raw_student_number text,
  grade text,
  campus text,
  subject text,
  school_year text,
  round_label text,
  answered_at timestamptz,
  link_status text,
  follow_status text,
  answers jsonb not null default '{}'::jsonb,
  free_text jsonb not null default '{}'::jsonb,
  internal_memo text,
  visible_in_karte boolean not null default true,
  raw_notion jsonb,
  notion_last_edited_time timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint survey_responses_link_status_check
    check (link_status is null or link_status in ('unmatched', 'candidate', 'linked', 'needs_review', 'ignored'))
);

create index if not exists survey_responses_student_number_idx
  on public.survey_responses (student_number, answered_at desc);

create index if not exists survey_responses_notion_student_page_idx
  on public.survey_responses (notion_student_page_id);

create index if not exists survey_responses_source_idx
  on public.survey_responses (source_name);

create table if not exists public.unmatched_records (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null,
  source_name text not null,
  source_record_id text not null,
  raw_student_name text,
  raw_student_number text,
  candidate_student_numbers text[] not null default '{}',
  status text not null default 'open',
  resolved_student_number text references public.student_roster (student_number) on delete set null,
  resolved_by text,
  resolved_at timestamptz,
  note text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unmatched_records_status_check check (status in ('open', 'resolved', 'ignored'))
);

create unique index if not exists unmatched_records_source_unique_idx
  on public.unmatched_records (source_kind, source_name, source_record_id);

create index if not exists unmatched_records_status_idx
  on public.unmatched_records (status, created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor text,
  action text not null,
  subject_type text not null,
  subject_id text,
  student_number text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_student_created_idx
  on public.audit_logs (student_number, created_at desc);

create index if not exists audit_logs_action_created_idx
  on public.audit_logs (action, created_at desc);
