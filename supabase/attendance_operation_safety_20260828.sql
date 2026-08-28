begin;

-- Replace a candidate header and every editable row atomically. A validation or
-- insert error rolls the whole operation back, so active rows cannot disappear.
create or replace function public.replace_attendance_candidate_draft(
  p_candidate_id uuid,
  p_candidate jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  updated_id uuid;
  editable_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) < 1
    or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 80 then
    raise exception '登録行は1〜80件で指定してください' using errcode = '22023';
  end if;

  update public.attendance_candidates
  set
    student_number = nullif(btrim(p_candidate ->> 'student_number'), ''),
    event_type = case
      when p_candidate ->> 'event_type' in ('absence', 'late', 'early_leave', 'reschedule_request', 'other')
        then p_candidate ->> 'event_type'
      else 'other'
    end,
    event_date = nullif(p_candidate ->> 'event_date', '')::date,
    lesson_id = nullif(p_candidate ->> 'lesson_id', '')::uuid,
    ai_summary = nullif(btrim(p_candidate ->> 'ai_summary'), '')
  where id = p_candidate_id
    and status in ('pending', 'notion_failed')
  returning id into updated_id;

  if updated_id is null then
    raise exception '候補が見つからないか、すでに処理されています' using errcode = 'P0001';
  end if;

  delete from public.attendance_candidate_items
  where candidate_id = p_candidate_id
    and status in ('pending', 'notion_failed');

  for item in select value from jsonb_array_elements(p_items)
  loop
    if nullif(item ->> 'id', '') is not null and exists (
      select 1
      from public.attendance_candidate_items
      where id = (item ->> 'id')::uuid
        and candidate_id = p_candidate_id
        and status = 'confirmed'
    ) then
      continue;
    end if;

    editable_count := editable_count + 1;
    insert into public.attendance_candidate_items (
      candidate_id,
      student_number,
      event_type,
      event_date,
      lesson_id,
      suggested_subject,
      suggested_class_name,
      ai_summary,
      arrival_expected_time,
      note_internal,
      note_for_classroom,
      cross_campus_override,
      cross_campus_reason,
      status
    ) values (
      p_candidate_id,
      nullif(btrim(item ->> 'student_number'), ''),
      case
        when item ->> 'event_type' in ('absence', 'late', 'early_leave', 'reschedule_request', 'other')
          then item ->> 'event_type'
        else 'other'
      end,
      nullif(item ->> 'event_date', '')::date,
      nullif(item ->> 'lesson_id', '')::uuid,
      nullif(btrim(item ->> 'suggested_subject'), ''),
      nullif(btrim(item ->> 'suggested_class_name'), ''),
      nullif(btrim(item ->> 'ai_summary'), ''),
      nullif(btrim(item ->> 'arrival_expected_time'), ''),
      nullif(btrim(item ->> 'note_internal'), ''),
      nullif(btrim(item ->> 'note_for_classroom'), ''),
      coalesce((item ->> 'cross_campus_override')::boolean, false),
      nullif(btrim(item ->> 'cross_campus_reason'), ''),
      'pending'
    );
  end loop;

  if editable_count = 0 then
    raise exception '再登録する未完了行がありません' using errcode = '22023';
  end if;

  return updated_id;
end
$$;

revoke all on function public.replace_attendance_candidate_draft(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_attendance_candidate_draft(uuid, jsonb, jsonb) to service_role;

-- Dismiss the candidate header and its active rows in the same transaction.
create or replace function public.dismiss_attendance_candidate(
  p_candidate_id uuid,
  p_actor text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  if nullif(btrim(p_actor), '') is null then
    raise exception '確認者名を入力してください' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.attendance_events
    where source_candidate_id = p_candidate_id
      and status <> 'cancelled'
  ) then
    raise exception '一部登録済みの候補は対応不要にできません。Notion登録を再試行してください' using errcode = 'P0001';
  end if;

  update public.attendance_candidates
  set
    status = 'dismissed',
    confirmed_by = btrim(p_actor),
    confirmed_at = now(),
    notion_error = null
  where id = p_candidate_id
    and status in ('pending', 'notion_failed')
  returning status into current_status;

  if current_status is null then
    select status into current_status
    from public.attendance_candidates
    where id = p_candidate_id;
    if current_status = 'dismissed' then
      return false;
    end if;
    if current_status is null then
      raise exception '候補が見つかりません' using errcode = 'P0002';
    end if;
    raise exception 'すでに別の処理が完了しています' using errcode = 'P0001';
  end if;

  update public.attendance_candidate_items
  set status = 'dismissed', notion_error = null
  where candidate_id = p_candidate_id
    and status in ('pending', 'notion_failed');

  return true;
end
$$;

revoke all on function public.dismiss_attendance_candidate(uuid, text) from public, anon, authenticated;
grant execute on function public.dismiss_attendance_candidate(uuid, text) to service_role;

-- Historical replies did not set reply_kind. They stay untouched; the constraint
-- applies only to newly audited initial replies.
create unique index if not exists line_messages_attendance_initial_reply_unique
  on public.line_messages ((raw_event ->> 'attendance_candidate_id'))
  where direction = 'outbound'
    and raw_event ->> 'send_context' = 'attendance_candidate_reply'
    and raw_event ->> 'reply_kind' = 'initial';

commit;
