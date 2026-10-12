begin;
create table if not exists public.staff_login_people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 50),
  name_key text not null unique,
  account_name text not null check (length(btrim(account_name)) between 1 and 100),
  sort_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.staff_login_people enable row level security;
revoke all on public.staff_login_people from public, anon, authenticated;
grant select,insert,update on public.staff_login_people to service_role;
commit;
