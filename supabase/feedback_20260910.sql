-- Requires staff_auth_20260905.sql. Applied by the transactional setup script.
create table if not exists public.bentan_feedback (
  id uuid primary key,
  sender_name text not null check (length(btrim(sender_name)) between 1 and 100),
  message text not null check (length(btrim(message)) between 1 and 2000),
  rate_key text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists bentan_feedback_created_idx on public.bentan_feedback(created_at desc, id desc);
create index if not exists bentan_feedback_rate_idx on public.bentan_feedback(rate_key, created_at);
create table if not exists public.bentan_feedback_reader (
  singleton boolean primary key default true check (singleton),
  staff_id uuid not null references public.staff_accounts(id) on delete restrict
);
alter table public.bentan_feedback enable row level security;
alter table public.bentan_feedback_reader enable row level security;
revoke all on public.bentan_feedback, public.bentan_feedback_reader from public, anon, authenticated;
grant all on public.bentan_feedback, public.bentan_feedback_reader to service_role;

create or replace function public.submit_bentan_feedback(p_id uuid, p_name text, p_message text, p_rate_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.bentan_feedback%rowtype;
begin
  if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 100
    or p_message is null or length(btrim(p_message)) not between 1 and 2000
    or p_rate_key is null or length(p_rate_key) <> 64 then raise exception 'invalid_feedback'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 910));
  select * into prior from public.bentan_feedback where id=p_id;
  if found then
    if prior.sender_name <> btrim(p_name) or prior.message <> btrim(p_message) then raise exception 'feedback_conflict'; end if;
    return jsonb_build_object('accepted', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_rate_key, 911));
  if (select count(*) from public.bentan_feedback where rate_key=p_rate_key and created_at > clock_timestamp()-interval '10 minutes') >= 10
    then raise exception 'feedback_rate_limit'; end if;
  insert into public.bentan_feedback(id,sender_name,message,rate_key) values(p_id,btrim(p_name),btrim(p_message),p_rate_key);
  return jsonb_build_object('accepted', true);
end;
$$;

create or replace function public.list_bentan_feedback(p_auth_user_id uuid, p_auth_session_id uuid, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare staff jsonb; rows jsonb; more boolean;
begin
  staff := public.staff_authorize(p_auth_user_id,p_auth_session_id);
  if not exists(select 1 from public.bentan_feedback_reader where singleton and staff_id=(staff->>'staffId')::uuid)
    then raise exception 'staff_permission_denied'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000 then raise exception 'invalid_feedback'; end if;
  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into rows from (
    select id,sender_name,message,created_at from public.bentan_feedback order by created_at desc,id desc limit 50 offset p_offset
  ) f;
  select exists(select 1 from public.bentan_feedback offset p_offset+50 limit 1) into more;
  return jsonb_build_object('feedback', rows, 'hasMore',more);
end;
$$;
revoke all on function public.submit_bentan_feedback(uuid,text,text,text),public.list_bentan_feedback(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.submit_bentan_feedback(uuid,text,text,text),public.list_bentan_feedback(uuid,uuid,integer) to service_role;
