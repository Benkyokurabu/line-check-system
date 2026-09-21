-- Links identify an invitation, never authenticate a user or grant staff access.
create or replace function public.interview_notification_link() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation uuid;
begin
 if tg_table_name='interview_invitations' then
  invitation:=new.id;
  new.message:=replace(new.message,'LINE下部の「面談予約」から希望時間をお選びください。','以下のリンクから希望時間をお選びください。');
 else
  select invitation_id into invitation from interview_parent_requests where id=new.request_id;
  new.message:=replace(new.message,'確定内容はLINE下部の「面談予約」から確認できます。','以下のリンクから確定内容を確認できます。');
 end if;
 new.message:=new.message||E'\nhttps://line-check-system.vercel.app/interviews/trial'||case when invitation is null then '' else '?invitation='||invitation::text end;
 return new;
end;$$;
create trigger interview_invitation_message_link before insert on interview_invitations for each row execute function interview_notification_link();
create trigger interview_confirmation_message_link before insert on interview_pilot_notifications for each row execute function interview_notification_link();
revoke all on function interview_notification_link() from public,anon,authenticated;
notify pgrst,'reload schema';
