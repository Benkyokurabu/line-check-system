create extension if not exists pgcrypto;

create table if not exists public.line_messages (
  id uuid primary key default gen_random_uuid(),
  line_message_id text unique,
  line_user_id text not null,
  display_name text,
  message_type text not null,
  text text,
  direction text not null,
  received_at timestamptz,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  constraint line_messages_direction_check
    check (direction in ('inbound', 'outbound')),
  constraint line_messages_message_type_check
    check (message_type in ('text', 'image', 'video', 'audio', 'file', 'sticker', 'unknown'))
);

create index if not exists line_messages_line_user_id_idx
  on public.line_messages (line_user_id);

create index if not exists line_messages_received_at_idx
  on public.line_messages (received_at);

create index if not exists line_messages_created_at_idx
  on public.line_messages (created_at);

create index if not exists line_messages_direction_idx
  on public.line_messages (direction);

create table if not exists public.line_tasks (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.line_messages (id),
  line_user_id text not null,
  student_name text,
  task_title text not null,
  category text,
  assignee text,
  priority text not null,
  status text not null,
  due_at timestamptz,
  ai_reason text,
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  constraint line_tasks_category_check
    check (
      category is null
      or category in (
        'absence',
        'makeup',
        'schedule',
        'billing',
        'refund',
        'lesson',
        'exam',
        'career',
        'study',
        'teacher_check',
        'other'
      )
    ),
  constraint line_tasks_priority_check
    check (priority in ('high', 'medium', 'low')),
  constraint line_tasks_status_check
    check (status in ('open', 'in_progress', 'resolved', 'ignored')),
  constraint line_tasks_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists line_tasks_message_id_idx
  on public.line_tasks (message_id);

create index if not exists line_tasks_line_user_id_idx
  on public.line_tasks (line_user_id);

create index if not exists line_tasks_status_idx
  on public.line_tasks (status);

create index if not exists line_tasks_priority_idx
  on public.line_tasks (priority);

create index if not exists line_tasks_due_at_idx
  on public.line_tasks (due_at);

create index if not exists line_tasks_created_at_idx
  on public.line_tasks (created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_line_tasks_updated_at'
      and tgrelid = 'public.line_tasks'::regclass
  ) then
    create trigger set_line_tasks_updated_at
      before update on public.line_tasks
      for each row
      execute function public.set_updated_at();
  end if;
end;
$$;
