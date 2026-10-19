-- Preserve every valid saved student/LINE pair in the current registration table.
-- Importing a link never grants human verification or changes an existing registration.
create or replace function public.preserve_student_line_registration()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.line_user_id ~ '^U[0-9a-fA-F]{32}$' and exists(select 1 from public.student_registry where student_number=new.student_number) then
    insert into public.student_line_accounts(student_number,line_user_id,relation,alias_name,is_primary,source,verification_status)
    values(new.student_number,new.line_user_id,'unknown',
      (select alias_name from public.line_user_aliases where line_user_id=new.line_user_id limit 1),false,'saved_student_link','unverified')
    on conflict(student_number,line_user_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.preserve_student_line_registration() from public;
drop trigger if exists preserve_student_line_registration on public.student_line_links;
create trigger preserve_student_line_registration after insert or update of student_number,line_user_id on public.student_line_links
for each row execute function public.preserve_student_line_registration();

insert into public.student_line_accounts(student_number,line_user_id,relation,alias_name,is_primary,source,verification_status)
select l.student_number,l.line_user_id,'unknown',a.alias_name,false,'saved_student_link','unverified'
from public.student_line_links l
join public.student_registry s on s.student_number=l.student_number
left join public.line_user_aliases a on a.line_user_id=l.line_user_id
where l.line_user_id ~ '^U[0-9a-fA-F]{32}$'
on conflict(student_number,line_user_id) do nothing;
