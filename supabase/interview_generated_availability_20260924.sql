begin;
create table if not exists public.interview_generated_availability (
 id uuid primary key default gen_random_uuid(),
 teacher text not null,
 slot_date date not null,
 start_time text not null check(start_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
 campus text not null check(campus in ('本校','南教室')),
 notion_page_id uuid unique,
 expected jsonb not null default '{}'::jsonb,
 notion_edited_at text,
 status text not null default 'active' check(status in ('active','archived','missing')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(teacher,slot_date,start_time)
);
create table if not exists public.interview_availability_runs (
 operation_key uuid primary key,
 actor uuid not null,
 target_month date not null check(target_month=date_trunc('month',target_month)::date),
 preview_hash text not null check(length(preview_hash)=64),
 status text not null check(status in ('applying','applied','failed')),
 result jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create index if not exists interview_generated_availability_month on public.interview_generated_availability(teacher,slot_date);
create index if not exists interview_availability_runs_month on public.interview_availability_runs(target_month,created_at desc);
alter table public.interview_generated_availability enable row level security;
alter table public.interview_availability_runs enable row level security;
revoke all on public.interview_generated_availability,public.interview_availability_runs from public,anon,authenticated;
grant all on public.interview_generated_availability,public.interview_availability_runs to service_role;
commit;
notify pgrst,'reload schema';
