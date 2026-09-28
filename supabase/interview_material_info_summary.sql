begin;

create table if not exists public.interview_material_info_summaries (
  student_number text primary key check (student_number ~ '^[0-9]{5,12}$'),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  fields jsonb not null check (jsonb_typeof(fields) = 'array'),
  status text not null check (status in ('queued','running','completed','failed')),
  requested boolean not null default false,
  result jsonb not null default '[]'::jsonb check (jsonb_typeof(result) = 'array'),
  error text,
  attempts integer not null default 0 check (attempts between 0 and 3),
  claimed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.interview_material_info_summaries add column if not exists requested boolean not null default false;
create index if not exists interview_material_info_summaries_queue
  on public.interview_material_info_summaries(status,updated_at);
alter table public.interview_material_info_summaries enable row level security;
revoke all on public.interview_material_info_summaries from public, anon, authenticated;
grant all on public.interview_material_info_summaries to service_role;

commit;
