-- Explicit staff confirmation of an already registered LINE/student pair.
-- No received message is invented; the human confirmation basis is audited.
create or replace function public.verify_existing_line_contact(
 p_line_user_id text,p_targets jsonb,p_friend_display_name text,p_verified_by text,p_review_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare target jsonb; result jsonb;
begin
 p_review_note := btrim(coalesce(p_review_note,''));
 if length(p_review_note)<3 or length(p_review_note)>1200 then raise exception '本人確認の方法を記録してください'; end if;
 if jsonb_typeof(p_targets) is distinct from 'array' then raise exception '登録対象が不正です'; end if;
 if jsonb_array_length(p_targets)<1 or jsonb_array_length(p_targets)>10 then raise exception '登録対象は1件から10件にしてください'; end if;
 for target in select value from jsonb_array_elements(p_targets) loop
  if coalesce(target->>'relation','') not in ('student','mother','father','guardian','family','shared') then raise exception '本人・続柄を確認してください'; end if;
  -- Lock the saved pair: a removed/revoked pair cannot be silently reactivated.
  perform 1 from public.student_line_accounts
   where student_number=target->>'student_number' and line_user_id=p_line_user_id
    and verification_status in ('unverified','needs_review','confirmed') for update;
  if not found then raise exception '登録済みの連絡先との組み合わせを確認してください'; end if;
 end loop;
 result := public.verify_line_contact(p_line_user_id,p_targets,p_friend_display_name,p_verified_by,null,'post_interview_manual_review');
 update public.line_contact_registration_events set evidence_text='職員による本人確認：'||p_review_note
  where line_user_id=p_line_user_id and performed_by=btrim(p_verified_by)
   and source='post_interview_manual_review' and created_at=(result->>'verified_at')::timestamptz;
 return result;
end; $$;
revoke all on function public.verify_existing_line_contact(text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.verify_existing_line_contact(text,jsonb,text,text,text) to service_role;
