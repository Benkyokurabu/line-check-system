begin;

create table if not exists public.interview_material_daily_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 run_time time not null default '06:00', days_ahead integer not null default 7 check(days_ahead between 0 and 30),
 updated_at timestamptz not null default now()
);
insert into public.interview_material_daily_settings(id) values(true) on conflict do nothing;
create table if not exists public.interview_material_daily_scans (
 run_date date not null, target_date date not null, status text not null default 'running' check(status in ('running','completed','failed')),
 worker_id text references public.interview_material_workers(id), lease uuid, lease_until timestamptz,
 report jsonb not null default '{}'::jsonb, error text, updated_at timestamptz not null default now(),
 primary key(run_date,target_date)
);
alter table public.interview_material_jobs add column if not exists daily_key text;
create unique index if not exists interview_material_jobs_daily_key_idx on public.interview_material_jobs(daily_key);
alter table public.interview_material_daily_settings enable row level security;
alter table public.interview_material_daily_scans enable row level security;
revoke all on public.interview_material_daily_settings, public.interview_material_daily_scans from anon, authenticated;
grant all on public.interview_material_daily_settings, public.interview_material_daily_scans to service_role;

-- Exactly one available worker plans one date. A failed scan resumes after five minutes.
create or replace function public.interview_material_daily_scan_claim(p_worker text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s interview_material_daily_settings%rowtype; local_now timestamp := now() at time zone 'Asia/Tokyo';
 target date; token uuid := gen_random_uuid(); priority_value integer;
begin
 select * into s from interview_material_daily_settings where id;
 if not s.enabled or local_now::time < s.run_time then return null; end if;
 select priority into priority_value from interview_material_workers where id=p_worker and ready and last_seen_at>now()-interval '35 seconds'
   and status @> '{"capabilities":["daily-offline-v1"]}'::jsonb;
 if priority_value is null or exists(select 1 from interview_material_workers where priority<priority_value and ready
   and last_seen_at>now()-interval '35 seconds' and status @> '{"capabilities":["daily-offline-v1"]}'::jsonb) then return null; end if;
 perform pg_advisory_xact_lock(hashtext('interview_material_daily_scan'));
 for target in select (local_now::date+i)::date from generate_series(0,s.days_ahead) i loop
  if exists(select 1 from interview_material_daily_scans where run_date=local_now::date and target_date=target
    and (status='completed' or lease_until>now() or updated_at>now()-interval '5 minutes')) then continue; end if;
  insert into interview_material_daily_scans(run_date,target_date,worker_id,lease,lease_until)
    values(local_now::date,target,p_worker,token,now()+interval '2 minutes')
    on conflict(run_date,target_date) do update set status='running',worker_id=excluded.worker_id,lease=excluded.lease,
      lease_until=excluded.lease_until,error=null,updated_at=now();
  return jsonb_build_object('runDate',local_now::date,'date',target,'lease',token);
 end loop;
 return null;
end $$;

-- Automatic jobs may wait longer than ten minutes. Interactive requests remain first.
create or replace function public.interview_material_claim(p_worker text)
returns setof public.interview_material_jobs language plpgsql security definer set search_path=public as $$
declare v_priority integer; v_daily boolean; v_job public.interview_material_jobs%rowtype;
begin
 select priority,status @> '{"capabilities":["daily-offline-v1"]}'::jsonb into v_priority,v_daily
   from interview_material_workers where id=p_worker and ready and last_seen_at>now()-interval '35 seconds';
 if v_priority is null then return; end if;
 select * into v_job from interview_material_jobs
  where expires_at>now() and ((status='queued' and (daily_key is not null or created_at>now()-interval '10 minutes'))
   or (status='running' and lease_until<now() and attempts<3)
   or (status='failed' and daily_key is not null and attempts<3 and completed_at<now()-interval '5 minutes'))
   and ((daily_key is null and not exists(select 1 from interview_material_workers
      where priority<v_priority and ready and last_seen_at>now()-interval '35 seconds'))
    or (daily_key is not null and v_daily and (payload->'autoDaily'->>'manual'='true'
      or exists(select 1 from interview_material_daily_settings where id and enabled))
      and not exists(select 1 from interview_material_workers
      where priority<v_priority and ready and last_seen_at>now()-interval '35 seconds'
        and status @> '{"capabilities":["daily-offline-v1"]}'::jsonb)))
  order by (daily_key is not null),created_at for update skip locked limit 1;
 if not found then return; end if;
 update interview_material_jobs set status='running',worker_id=p_worker,lease_token=gen_random_uuid(),
  lease_until=now()+interval '45 seconds',attempts=attempts+1 where id=v_job.id returning * into v_job;
 return next v_job;
end $$;
revoke all on function public.interview_material_daily_scan_claim(text) from public,anon,authenticated;
grant execute on function public.interview_material_daily_scan_claim(text) to service_role;
commit;
