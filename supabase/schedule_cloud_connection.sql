-- Connection credentials are encrypted with the server's existing secret key.
-- This table does not modify lesson or attendance records.
create table if not exists public.schedule_cloud_connection (
  id text primary key check (id = 'primary'),
  encrypted text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.schedule_cloud_connection enable row level security;
revoke all on public.schedule_cloud_connection from public, anon, authenticated;
grant select, insert, update on public.schedule_cloud_connection to service_role;
