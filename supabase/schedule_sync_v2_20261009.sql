-- Additive schedule sync RPCs for the Kinjo and Kudo Notion integration.
-- Apply this file before deploying the new app. Legacy RPCs remain unchanged.
-- Version 2 retains the original RPCs for the currently deployed app. Publish
-- these functions together, then deploy the app that uses them.
begin;
create or replace function public.schedule_sync_apply_v2(p_run uuid, p_report jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  -- Both calls run in one transaction, so the original lease release is never
  -- visible to another sync before it is reacquired here.
  result := public.schedule_sync_apply(p_run,p_report);
  update public.schedule_sync_runs set status='running',finished_at=null,message=''
    where id=p_run and status=result->>'status';
  if not found then raise exception 'invalid v2 run'; end if;
  update public.schedule_sync_control set lease_until=now()+interval '3 minutes'
    where id=true and run_id=p_run;
  if not found then raise exception 'lease lost'; end if;
  return result;
end $$;

create or replace function public.schedule_sync_finish_v2(p_run uuid, p_status text, p_message text, p_report jsonb default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.schedule_sync_control where id=true and run_id=p_run for update;
  if not found then raise exception 'lease lost'; end if;
  if p_status not in ('error','waiting','review','applied','unchanged') then raise exception 'invalid finish status'; end if;
  update public.schedule_sync_runs set status=p_status,message=left(p_message,2000),finished_at=now(),
    summary=coalesce(p_report->'summary',summary),source=coalesce(p_report->'source',source),
    snapshot=coalesce(p_report,snapshot) where id=p_run and status='running';
  if not found then raise exception 'run already finished'; end if;
  update public.schedule_sync_control set lease_until=null where id=true and run_id=p_run;
end $$;

create or replace function public.schedule_sync_v2_ready()
returns boolean language sql stable as $$ select true $$;

revoke all on function public.schedule_sync_apply_v2(uuid,jsonb), public.schedule_sync_finish_v2(uuid,text,text,jsonb),
  public.schedule_sync_v2_ready() from public, anon, authenticated;
grant execute on function public.schedule_sync_apply_v2(uuid,jsonb), public.schedule_sync_finish_v2(uuid,text,text,jsonb),
  public.schedule_sync_v2_ready() to service_role;
commit;
notify pgrst, 'reload schema';
