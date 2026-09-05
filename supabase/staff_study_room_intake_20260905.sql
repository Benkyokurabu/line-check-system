-- Unapplied. Requires staff_auth_20260905.sql. Does not enable the workflow.
begin;
alter table public.staff_auth_settings add column if not exists proxy_defaults_seeded boolean not null default false;
insert into public.staff_role_permissions(role,permission)
  select r,'study_room.submit' from unnest(array['admin','office']) r
  where exists(select 1 from public.staff_auth_settings where singleton and not proxy_defaults_seeded)
  on conflict do nothing;
update public.staff_auth_settings set proxy_defaults_seeded=true where singleton and not proxy_defaults_seeded;

-- Preserve why/how a staff member entered a request without pretending that the
-- staff member was the LINE sender. Kept separately from seat inventory.
create table if not exists public.study_room_staff_intakes (
  request_id uuid primary key references public.study_room_requests(id) on delete restrict,
  staff_id uuid not null references public.staff_accounts(id) on delete restrict,
  contact_channel text not null check (contact_channel in ('line_message','in_person','phone','other')),
  note text not null check (length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.study_room_staff_intakes enable row level security;
revoke all on public.study_room_staff_intakes from public,anon,authenticated,service_role;

create or replace function public.staff_study_room_submit(
  p_auth_user_id uuid, p_auth_session_id uuid, p_operation_key uuid,
  p_student_number text, p_date date, p_seat integer, p_slot_ids text[],
  p_contact_channel text, p_note text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_staff jsonb; v_result jsonb; v_id uuid; v_intake public.study_room_staff_intakes%rowtype;
begin
  v_staff := public.staff_authorize(p_auth_user_id,p_auth_session_id,'study_room.submit');
  if p_contact_channel is null or p_contact_channel not in ('line_message','in_person','phone','other')
    or p_note is null or length(btrim(p_note)) not between 1 and 2000 then
    raise exception 'invalid_request';
  end if;
  if not exists(select 1 from public.student_roster where student_number=p_student_number) then
    raise exception 'student_not_found';
  end if;
  -- Uses the same day lock, vacancy rules, duplicate checks and operation ID as
  -- normal requests. This creates only a pending request, NEVER an active seat.
  v_result := public.study_room_submit_request(p_operation_key,p_student_number,p_date,p_seat,p_slot_ids,
    'staff',v_staff->>'staffId','staff');
  v_id := (v_result->'request'->>'id')::uuid;
  if (v_result->>'replayed')::boolean then
    select * into v_intake from public.study_room_staff_intakes where request_id=v_id;
    if not found or v_intake.staff_id <> (v_staff->>'staffId')::uuid
      or v_intake.contact_channel <> p_contact_channel or v_intake.note <> btrim(p_note) then
      raise exception 'idempotency_conflict';
    end if;
  else
    insert into public.study_room_staff_intakes(request_id,staff_id,contact_channel,note)
      values (v_id,(v_staff->>'staffId')::uuid,p_contact_channel,btrim(p_note));
  end if;
  return v_result;
end;
$$;
revoke all on function public.staff_study_room_submit(uuid,uuid,uuid,text,date,integer,text[],text,text)
  from public,anon,authenticated;
grant execute on function public.staff_study_room_submit(uuid,uuid,uuid,text,date,integer,text[],text,text) to service_role;
commit;
