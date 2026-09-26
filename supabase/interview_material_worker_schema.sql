begin;

create table if not exists public.interview_material_workers (
  id text primary key check (id ~ '^[a-z0-9_-]{3,32}$'),
  secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
  priority integer not null unique check (priority between 1 and 9),
  ready boolean not null default false,
  last_seen_at timestamptz,
  status jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.interview_material_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('preview', 'generate')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  staff_code text not null,
  payload jsonb not null,
  result jsonb,
  error text,
  worker_id text references public.interview_material_workers(id),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '1 day')
);
create index if not exists interview_material_jobs_queue_idx on public.interview_material_jobs(status, created_at);
create index if not exists interview_material_jobs_expiry_idx on public.interview_material_jobs(expires_at);

alter table public.interview_material_workers enable row level security;
alter table public.interview_material_jobs enable row level security;
revoke all on public.interview_material_workers, public.interview_material_jobs from anon, authenticated;
grant all on public.interview_material_workers, public.interview_material_jobs to service_role;

create or replace function public.interview_material_claim(p_worker text)
returns setof public.interview_material_jobs
language plpgsql security definer set search_path = public
as $$
declare v_priority integer; v_job public.interview_material_jobs%rowtype;
begin
  select priority into v_priority from public.interview_material_workers
   where id = p_worker and ready and last_seen_at > now() - interval '35 seconds';
  if v_priority is null then return; end if;
  if exists (select 1 from public.interview_material_workers
       where priority < v_priority and ready and last_seen_at > now() - interval '35 seconds') then
    return;
  end if;
  select * into v_job from public.interview_material_jobs
   where (status = 'queued' and created_at > now() - interval '10 minutes')
      or (status = 'running' and lease_until < now() and attempts < 3)
   order by created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.interview_material_jobs set status = 'running', worker_id = p_worker,
    lease_token = gen_random_uuid(), lease_until = now() + interval '45 seconds',
    attempts = attempts + 1
   where id = v_job.id returning * into v_job;
  return next v_job;
end $$;

create or replace function public.interview_material_renew(p_job uuid, p_worker text, p_lease uuid)
returns boolean language sql security definer set search_path = public
as $$
  with updated as (
    update public.interview_material_jobs set lease_until = now() + interval '45 seconds'
    where id = p_job and worker_id = p_worker and lease_token = p_lease and status = 'running'
      and lease_until > now() returning 1
  ) select exists(select 1 from updated)
$$;

create or replace function public.interview_material_finish(p_job uuid, p_worker text, p_lease uuid,
  p_status text, p_result jsonb, p_error text)
returns boolean language sql security definer set search_path = public
as $$
  with updated as (
    update public.interview_material_jobs
      set status = p_status, result = case when p_status = 'completed' then p_result else null end,
          error = case when p_status = 'failed' then left(p_error, 300) else null end,
          completed_at = now(), lease_until = null
    where id = p_job and worker_id = p_worker and lease_token = p_lease and status = 'running'
      and lease_until > now() and p_status in ('completed', 'failed') returning 1
  ) select exists(select 1 from updated)
$$;

revoke all on function public.interview_material_claim(text),
  public.interview_material_renew(uuid,text,uuid),
  public.interview_material_finish(uuid,text,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.interview_material_claim(text),
  public.interview_material_renew(uuid,text,uuid),
  public.interview_material_finish(uuid,text,uuid,text,jsonb,text) to service_role;

insert into storage.buckets(id, name, public, file_size_limit)
values ('interview-material-bundles', 'interview-material-bundles', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

commit;
