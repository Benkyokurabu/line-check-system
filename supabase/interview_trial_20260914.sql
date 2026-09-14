begin;
create table if not exists public.staff_interview_trial_state(
 id text primary key check(id='main'),version bigint not null default 1,
 state jsonb not null default '{"rows":[],"operations":[],"events":[]}'::jsonb,
 updated_at timestamptz not null default now()
);
insert into public.staff_interview_trial_state(id) values('main') on conflict do nothing;
alter table public.staff_interview_trial_state enable row level security;
revoke all on public.staff_interview_trial_state from public,anon,authenticated;
grant select,update on public.staff_interview_trial_state to service_role;
commit;
