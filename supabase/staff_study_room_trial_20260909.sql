-- Shared staff exercise only. No foreign keys to real students or reservations,
-- no notification jobs. Authenticated application server is the only caller.
begin;
create table if not exists public.staff_study_room_trial_state (
  id text primary key check(id='main'),
  version integer not null default 1 check(version>0),
  state jsonb not null default '{}'::jsonb,
  audit jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.staff_study_room_trial_state enable row level security;
revoke all on public.staff_study_room_trial_state from public,anon,authenticated;
grant select,update on public.staff_study_room_trial_state to service_role;
insert into public.staff_study_room_trial_state(id) values('main') on conflict do nothing;
commit;
