-- Additive migration. Existing submissions have an unknown sharing preference.
alter table public.bentan_feedback add column if not exists sharing_preference text not null default 'unspecified'
  check (sharing_preference in ('anonymous','named','unspecified'));

create or replace function public.submit_bentan_feedback(p_id uuid,p_name text,p_message text,p_rate_key text,p_sharing_preference text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.bentan_feedback%rowtype;
begin
  if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 100
    or p_message is null or length(btrim(p_message)) not between 1 and 2000
    or p_rate_key is null or length(p_rate_key) <> 64
    or p_sharing_preference is null or p_sharing_preference not in ('anonymous','named','unspecified') then raise exception 'invalid_feedback'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,910));
  select * into prior from public.bentan_feedback where id=p_id;
  if found then
    if prior.sender_name<>btrim(p_name) or prior.message<>btrim(p_message) or prior.sharing_preference<>p_sharing_preference then raise exception 'feedback_conflict'; end if;
    return jsonb_build_object('accepted',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_rate_key,911));
  if (select count(*) from public.bentan_feedback where rate_key=p_rate_key and created_at>clock_timestamp()-interval '10 minutes')>=10 then raise exception 'feedback_rate_limit'; end if;
  insert into public.bentan_feedback(id,sender_name,message,rate_key,sharing_preference) values(p_id,btrim(p_name),btrim(p_message),p_rate_key,p_sharing_preference);
  return jsonb_build_object('accepted',true);
end;
$$;
-- Preserve the existing four-argument API during deployment and for older clients.
create or replace function public.submit_bentan_feedback(p_id uuid,p_name text,p_message text,p_rate_key text)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select public.submit_bentan_feedback(p_id,p_name,p_message,p_rate_key,'unspecified');
$$;

create or replace function public.list_bentan_feedback(p_auth_user_id uuid,p_auth_session_id uuid,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare staff jsonb; rows jsonb; more boolean;
begin
  staff:=public.staff_authorize(p_auth_user_id,p_auth_session_id);
  if not exists(select 1 from public.bentan_feedback_reader where singleton and staff_id=(staff->>'staffId')::uuid) then raise exception 'staff_permission_denied'; end if;
  if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'invalid_feedback'; end if;
  select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) into rows from (
    select id,sender_name,message,created_at,sharing_preference from public.bentan_feedback order by created_at desc,id desc limit 50 offset p_offset
  ) f;
  select exists(select 1 from public.bentan_feedback offset p_offset+50 limit 1) into more;
  return jsonb_build_object('feedback',rows,'hasMore',more);
end;
$$;
revoke all on function public.submit_bentan_feedback(uuid,text,text,text,text),public.submit_bentan_feedback(uuid,text,text,text),public.list_bentan_feedback(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.submit_bentan_feedback(uuid,text,text,text,text),public.submit_bentan_feedback(uuid,text,text,text),public.list_bentan_feedback(uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
