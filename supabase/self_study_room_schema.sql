create table if not exists public.study_room_day_settings (
  reservation_date date primary key,
  limit_minutes integer not null default 0 check (limit_minutes in (0, 90, 180, 270)),
  closed_slot_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.study_room_reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_date date not null,
  slot_id text not null,
  start_time text not null,
  end_time text not null,
  seat smallint not null check (seat between 1 and 10),
  student_number text not null references public.student_roster(student_number) on delete restrict,
  grade text not null,
  student_name text not null,
  minutes integer not null default 90 check (minutes = 90),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create unique index if not exists study_room_active_seat_slot_idx
  on public.study_room_reservations (reservation_date, slot_id, seat) where status = 'active';
create unique index if not exists study_room_active_student_slot_idx
  on public.study_room_reservations (reservation_date, slot_id, student_number) where status = 'active';
create index if not exists study_room_reservations_date_idx
  on public.study_room_reservations (reservation_date, status);
