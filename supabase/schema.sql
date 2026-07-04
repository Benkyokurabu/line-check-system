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
  sent_by text,
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

create table if not exists public.line_user_aliases (
  line_user_id text primary key,
  alias_name text, -- nullable: a contact can carry only a group_name (no custom display alias)
  group_name text,
  updated_at timestamptz not null default now()
);

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

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value, description)
values
  (
    'ai_model',
    '"openai/gpt-oss-120b"'::jsonb,
    'AI model ID used for message routing.'
  ),
  (
    'teacher_notify_confidence_threshold',
    '0.45'::jsonb,
    'Minimum route confidence to include a teacher in a wider notification candidate list.'
  ),
  (
    'teacher_direct_confidence_threshold',
    '0.75'::jsonb,
    'Minimum route confidence to treat a teacher as a strong notification target.'
  ),
  (
    'conversation_lookback_hours',
    '72'::jsonb,
    'How many hours of recent messages to include when judging whether a conversation is continuing.'
  ),
  (
    'conversation_lookback_message_count',
    '10'::jsonb,
    'Maximum number of recent messages to include when judging whether a conversation is continuing.'
  ),
  (
    'digest_notification_times',
    '["12:00", "17:00", "21:00"]'::jsonb,
    'Local times for Teams digest notifications.'
  )
on conflict (key) do nothing;

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  aliases text[] not null default '{}',
  notification_enabled boolean not null default true,
  notification_channel text not null default 'teams',
  notification_target text,
  notify_confidence_threshold numeric,
  direct_confidence_threshold numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teachers_notification_channel_check
    check (notification_channel in ('teams', 'email', 'none')),
  constraint teachers_notify_confidence_threshold_check
    check (
      notify_confidence_threshold is null
      or (notify_confidence_threshold >= 0 and notify_confidence_threshold <= 1)
    ),
  constraint teachers_direct_confidence_threshold_check
    check (
      direct_confidence_threshold is null
      or (direct_confidence_threshold >= 0 and direct_confidence_threshold <= 1)
    )
);

create unique index if not exists teachers_display_name_idx
  on public.teachers (display_name);

create index if not exists teachers_notification_enabled_idx
  on public.teachers (notification_enabled);

create table if not exists public.ai_message_routes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.line_messages (id),
  line_user_id text not null,
  teacher_id uuid references public.teachers (id),
  teacher_name text not null,
  confidence numeric not null,
  route_type text not null default 'candidate',
  matched_alias text,
  reason text,
  topic text,
  is_continuation boolean,
  prompt_version text,
  model text,
  raw_result jsonb,
  created_at timestamptz not null default now(),
  handled_status text not null default 'pending',
  handled_at timestamptz,
  constraint ai_message_routes_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint ai_message_routes_route_type_check
    check (route_type in ('direct', 'candidate', 'digest', 'fallback', 'ignored')),
  constraint ai_message_routes_handled_status_check
    check (handled_status in ('pending', 'done')),
  constraint ai_message_routes_message_teacher_unique
    unique (message_id, teacher_name)
);

create index if not exists ai_message_routes_message_id_idx
  on public.ai_message_routes (message_id);

create index if not exists ai_message_routes_line_user_id_idx
  on public.ai_message_routes (line_user_id);

create index if not exists ai_message_routes_teacher_id_idx
  on public.ai_message_routes (teacher_id);

create index if not exists ai_message_routes_confidence_idx
  on public.ai_message_routes (confidence);

create index if not exists ai_message_routes_created_at_idx
  on public.ai_message_routes (created_at);

create table if not exists public.teacher_notifications (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.line_messages (id),
  route_id uuid references public.ai_message_routes (id),
  teacher_id uuid references public.teachers (id),
  teacher_name text not null,
  notification_type text not null,
  channel text not null default 'teams',
  target text,
  status text not null default 'pending',
  scheduled_for timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  error_message text,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_notifications_type_check
    check (notification_type in ('immediate', 'digest', 'manual')),
  constraint teacher_notifications_channel_check
    check (channel in ('teams', 'email', 'none')),
  constraint teacher_notifications_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  constraint teacher_notifications_message_teacher_type_unique
    unique (message_id, teacher_name, notification_type)
);

create index if not exists teacher_notifications_message_id_idx
  on public.teacher_notifications (message_id);

create index if not exists teacher_notifications_route_id_idx
  on public.teacher_notifications (route_id);

create index if not exists teacher_notifications_teacher_id_idx
  on public.teacher_notifications (teacher_id);

create index if not exists teacher_notifications_status_idx
  on public.teacher_notifications (status);

create index if not exists teacher_notifications_scheduled_for_idx
  on public.teacher_notifications (scheduled_for);

create index if not exists teacher_notifications_created_at_idx
  on public.teacher_notifications (created_at);

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

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_app_settings_updated_at'
      and tgrelid = 'public.app_settings'::regclass
  ) then
    create trigger set_app_settings_updated_at
      before update on public.app_settings
      for each row
      execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_teachers_updated_at'
      and tgrelid = 'public.teachers'::regclass
  ) then
    create trigger set_teachers_updated_at
      before update on public.teachers
      for each row
      execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_teacher_notifications_updated_at'
      and tgrelid = 'public.teacher_notifications'::regclass
  ) then
    create trigger set_teacher_notifications_updated_at
      before update on public.teacher_notifications
      for each row
      execute function public.set_updated_at();
  end if;
end;
$$;
