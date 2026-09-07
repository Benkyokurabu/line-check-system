-- Trusted-folder synchronizer. No browser role can invoke mutations or read snapshots.
create table if not exists public.schedule_sync_runs (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  trigger text not null check (trigger in ('manual','cron')),
  status text not null default 'running' check (status in ('running','applied','unchanged','review','error','waiting')),
  message text not null default '', started_at timestamptz not null default now(), finished_at timestamptz,
  summary jsonb, source jsonb, snapshot jsonb
);
create index if not exists schedule_sync_runs_month_started on public.schedule_sync_runs(month, started_at desc);
create table if not exists public.schedule_sync_control (
  id boolean primary key default true check(id), run_id uuid references public.schedule_sync_runs(id),
  lease_until timestamptz, last_started_at timestamptz, enabled boolean not null default false
);
insert into public.schedule_sync_control(id) values(true) on conflict do nothing;
alter table public.schedule_sync_runs enable row level security;
alter table public.schedule_sync_control enable row level security;
revoke all on public.schedule_sync_runs, public.schedule_sync_control from public, anon, authenticated;
grant select, insert, update on public.schedule_sync_runs, public.schedule_sync_control to service_role;

create or replace function public.schedule_sync_claim(p_month text, p_trigger text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.schedule_sync_control%rowtype; r uuid; current_month text;
begin
  current_month := to_char(now() at time zone 'Asia/Tokyo','YYYY-MM');
  if p_month not in (current_month,to_char((now() at time zone 'Asia/Tokyo')+interval '1 month','YYYY-MM')) then raise exception 'invalid month'; end if;
  select * into c from public.schedule_sync_control where id=true for update;
  if not c.enabled then raise exception 'schedule sync disabled'; end if;
  if c.lease_until > now() or c.last_started_at > now()-interval '1 minute' then return null; end if;
  update public.schedule_sync_runs set status='error', message='処理が時間内に完了しませんでした。再試行します。', finished_at=now()
    where id=c.run_id and status='running';
  insert into public.schedule_sync_runs(month,trigger) values(p_month,p_trigger) returning id into r;
  update public.schedule_sync_control set run_id=r,lease_until=now()+interval '3 minutes',last_started_at=now() where id=true;
  return r;
end $$;

create or replace function public.schedule_sync_finish(p_run uuid, p_status text, p_message text, p_report jsonb default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.schedule_sync_control where id=true and run_id=p_run for update;
  if not found then raise exception 'lease lost'; end if;
  if p_status not in ('error','waiting','review') then raise exception 'invalid finish status'; end if;
  update public.schedule_sync_runs set status=p_status,message=left(p_message,2000),finished_at=now(),
    summary=p_report->'summary',source=p_report->'source',snapshot=p_report where id=p_run and status='running';
  update public.schedule_sync_control set lease_until=null where id=true and run_id=p_run;
end $$;

create or replace function public.schedule_sync_apply(p_run uuid, p_report jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.schedule_sync_runs%rowtype; c jsonb; a jsonb; existing_count integer; changed integer:=0; result_status text;
begin
  perform 1 from public.schedule_sync_control where id=true and enabled and run_id=p_run and lease_until>now() for update;
  if not found then raise exception 'lease lost'; end if;
  select * into r from public.schedule_sync_runs where id=p_run and status='running' for update;
  if not found or p_report->>'month' is distinct from r.month then raise exception 'invalid run'; end if;
  if jsonb_typeof(p_report->'existing') is distinct from 'array' or jsonb_typeof(p_report->'changes') is distinct from 'array'
    or jsonb_array_length(p_report->'lessons')<1 then raise exception 'invalid plan'; end if;
  -- Prevent any attendance importer or another lesson writer from changing the snapshot mid-commit.
  lock table public.lessons in share row exclusive mode;
  select count(*) into existing_count from public.lessons where lesson_date>= (r.month||'-01')::date and lesson_date< (r.month||'-01')::date+interval '1 month';
  if existing_count <> jsonb_array_length(p_report->'existing') or exists (
    select 1 from jsonb_array_elements(p_report->'existing') e left join public.lessons l on l.id=(e->>'id')::uuid
    where l.id is null or l.updated_at is distinct from (e->>'updated_at')::timestamptz
      or to_char(l.lesson_date,'YYYY-MM')<>r.month
  ) then raise exception 'snapshot changed'; end if;
  for c in select value from jsonb_array_elements(p_report->'changes') loop
    if c->>'kind' not in ('add','update') then raise exception 'review required'; end if;
    a:=c->'after';
    if left(a->>'lesson_date',7) is distinct from r.month then raise exception 'invalid lesson month'; end if;
    if c->>'kind'='add' then
      insert into public.lessons(lesson_date,start_time,grade,class_name,subject,campus,classroom,teacher_name,label,source_key,source_file,source_payload)
      values((a->>'lesson_date')::date,a->>'start_time',a->>'grade',a->>'class_name',a->>'subject',a->>'campus',a->>'classroom',a->>'teacher_name',a->>'label',a->>'source_key',p_report#>>'{source,file}',a->'source_payload');
    else
      -- Keep the primary key: attendance records continue to refer to this lesson.
      update public.lessons set start_time=a->>'start_time',classroom=a->>'classroom',teacher_name=a->>'teacher_name',label=a->>'label',
        source_key=a->>'source_key',source_file=p_report#>>'{source,file}',source_payload=a->'source_payload',updated_at=clock_timestamp()
      where id=(c#>>'{before,id}')::uuid and lesson_date=(a->>'lesson_date')::date
        and campus is not distinct from a->>'campus' and grade is not distinct from a->>'grade'
        and class_name is not distinct from a->>'class_name' and subject is not distinct from a->>'subject';
      if not found then raise exception 'unsafe identity change'; end if;
    end if;
    changed:=changed+1;
  end loop;
  result_status:=case when changed=0 then 'unchanged' else 'applied' end;
  update public.schedule_sync_runs set status=result_status,finished_at=now(),summary=p_report->'summary',source=p_report->'source',
    snapshot=case when changed>0 then p_report else null end where id=p_run;
  update public.schedule_sync_control set lease_until=null where id=true and run_id=p_run;
  return jsonb_build_object('status',result_status,'summary',p_report->'summary','runId',p_run);
end $$;
revoke all on function public.schedule_sync_claim(text,text), public.schedule_sync_finish(uuid,text,text,jsonb), public.schedule_sync_apply(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.schedule_sync_claim(text,text), public.schedule_sync_finish(uuid,text,text,jsonb), public.schedule_sync_apply(uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
