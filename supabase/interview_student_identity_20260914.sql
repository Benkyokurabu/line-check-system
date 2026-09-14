begin;
-- Keep the original interview UUIDs, then let the registry carry that identity.
lock table public.student_registry in access exclusive mode;
lock table public.interview_students in access exclusive mode;
alter table public.student_registry add column if not exists interview_student_id uuid;
alter table public.interview_students alter column student_number drop not null;
alter table public.interview_students add column if not exists last_student_number text;
alter table public.interview_students add column if not exists last_notion_page_id uuid;
alter table public.interview_students add column if not exists retired_at timestamptz;
update public.student_registry r set interview_student_id=i.id
 from public.interview_students i where r.student_number=i.student_number and r.interview_student_id is null;
update public.student_registry set interview_student_id=gen_random_uuid() where interview_student_id is null;
insert into public.interview_students(id,student_number,notion_page_id)
 select interview_student_id,student_number,notion_page_id from public.student_registry
 on conflict(id) do nothing;
update public.interview_students set last_student_number=student_number,last_notion_page_id=notion_page_id
 where student_number is not null;
alter table public.student_registry alter column interview_student_id set default gen_random_uuid();
alter table public.student_registry alter column interview_student_id set not null;
create unique index if not exists student_registry_interview_identity_unique on public.student_registry(interview_student_id);

create or replace function public.interview_registry_identity_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and new.interview_student_id is distinct from old.interview_student_id then
  raise exception 'student_identity_immutable';
 elsif tg_op='INSERT' and exists(select 1 from interview_students where id=new.interview_student_id) then
  raise exception 'student_identity_already_used';
 end if;
 return new;
end;$$;

create or replace function public.interview_registry_identity_sync() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then
  update interview_students set student_number=null,notion_page_id=null,retired_at=clock_timestamp()
   where id=old.interview_student_id;
  return old;
 elsif tg_op='INSERT' then
  insert into interview_students(id,student_number,notion_page_id,last_student_number,last_notion_page_id)
   values(new.interview_student_id,new.student_number,new.notion_page_id,new.student_number,new.notion_page_id);
 else
  update interview_students set student_number=new.student_number,notion_page_id=new.notion_page_id,
   last_student_number=new.student_number,last_notion_page_id=new.notion_page_id
   where id=new.interview_student_id;
  if not found then raise exception 'student_identity_missing'; end if;
 end if;
 return new;
end;$$;
drop trigger if exists interview_registry_identity_guard on public.student_registry;
create trigger interview_registry_identity_guard before insert or update on public.student_registry
 for each row execute function public.interview_registry_identity_guard();
drop trigger if exists interview_registry_identity_sync on public.student_registry;
create trigger interview_registry_identity_sync after insert or update or delete on public.student_registry
 for each row execute function public.interview_registry_identity_sync();

-- Existing save code uses the unique current number. The trigger moves that number
-- atomically and clears it on deletion, so an archived UUID cannot resolve to a new child.
create or replace function public.interview_snapshot() returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select md5(concat(
 (select version from interview_settings where id),
 (select coalesce(string_agg(id::text||version::text,',' order by id),'') from interview_bookings),
 (select coalesce(string_agg(id::text||updated_at::text,',' order by id),'') from lessons),
 (select coalesce(string_agg(student_number||interview_student_id::text||coalesce(notion_page_id::text,'')||updated_at::text,',' order by student_number),'') from student_registry)
 ));
$$;
revoke all on function public.interview_registry_identity_guard(),public.interview_registry_identity_sync() from public,anon,authenticated;
commit;
