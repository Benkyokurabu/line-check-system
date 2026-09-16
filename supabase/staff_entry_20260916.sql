begin;
create table if not exists public.staff_entry_keys (
 staff_code text primary key references public.staff_accounts(staff_code) on delete restrict check(staff_code in ('KUDO','KINJO')),
 key_hash text unique not null check(key_hash ~ '^[a-f0-9]{64}$'),
 enabled boolean not null default true,
 expires_at timestamptz not null default now()+interval '180 days',
 created_at timestamptz not null default now(),last_used_at timestamptz,
 window_start timestamptz not null default now(),attempts integer not null default 0
);
alter table public.staff_entry_keys enable row level security;
revoke all on public.staff_entry_keys from public,anon,authenticated;
grant all on public.staff_entry_keys to service_role;
create or replace function public.staff_entry_target(p_key_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare k staff_entry_keys%rowtype; target record;
begin
 if not exists(select 1 from staff_auth_settings where singleton and enabled) then return null; end if;
 select * into k from staff_entry_keys where key_hash=p_key_hash and enabled and expires_at>clock_timestamp() for update;
 if not found then return null; end if;
 select s.staff_code,s.auth_user_id,u.email into target from staff_accounts s join auth.users u on u.id=s.auth_user_id
  where s.staff_code=k.staff_code and s.staff_code in ('KUDO','KINJO') and s.active and u.email is not null
  and (u.banned_until is null or u.banned_until<=clock_timestamp());
 if not found then return null; end if;
 if k.window_start+interval '1 minute'<=clock_timestamp() then
  update staff_entry_keys set window_start=clock_timestamp(),attempts=0 where staff_code=k.staff_code;
 elsif k.attempts>=10 then return jsonb_build_object('limited',true); end if;
 update staff_entry_keys set last_used_at=clock_timestamp(),attempts=attempts+1 where staff_code=k.staff_code;
 return jsonb_build_object('staffCode',target.staff_code,'authUserId',target.auth_user_id,'email',target.email);
end;$$;
revoke all on function public.staff_entry_target(text) from public,anon,authenticated;
grant execute on function public.staff_entry_target(text) to service_role;
commit;
