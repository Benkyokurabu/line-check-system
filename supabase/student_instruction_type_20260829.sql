begin;

alter table public.student_roster
  add column if not exists instruction_type text;

comment on column public.student_roster.instruction_type is
  'Notion生徒情報DBの授業形態（例: 集団、個別ほか、併用）。未設定はnull。';

create or replace function public.get_line_contact_admin_summaries()
returns table (
  line_user_id text,
  display_name text,
  alias_name text,
  group_name text,
  latest_message_at timestamptz,
  latest_text text,
  registered_accounts jsonb,
  system_verified boolean,
  pending_evidence boolean,
  verified_by text,
  verified_at timestamptz,
  registration_state text
)
language sql
stable
security definer
set search_path = public
as $$
  with contact_ids as (
    select messages.line_user_id from public.line_messages as messages
    union
    select aliases.line_user_id from public.line_user_aliases as aliases
    union
    select accounts.line_user_id from public.student_line_accounts as accounts
  ), latest_messages as (
    select distinct on (messages.line_user_id)
      messages.line_user_id,
      messages.display_name,
      messages.text,
      coalesce(messages.received_at, messages.created_at) as message_at
    from public.line_messages as messages
    order by messages.line_user_id,
      coalesce(messages.received_at, messages.created_at) desc,
      messages.created_at desc
  ), account_summaries as (
    select
      accounts.line_user_id,
      jsonb_agg(jsonb_build_object(
        'student_number', accounts.student_number,
        'student_name', roster.student_name,
        'grade', roster.grade,
        'instruction_type', roster.instruction_type,
        'campus', roster.campus,
        'school_name', roster.school_name,
        'relation', accounts.relation,
        'alias_name', accounts.alias_name,
        'verification_status', accounts.verification_status,
        'verified_by', accounts.verified_by,
        'verified_at', accounts.verified_at,
        'evidence_message_id', accounts.evidence_message_id,
        'verification_source', accounts.verification_source
      ) order by accounts.verified_at desc nulls last, roster.student_name) as registered_accounts,
      bool_or(accounts.verification_status = 'confirmed') as system_verified,
      (array_agg(accounts.verified_by order by accounts.verified_at desc nulls last)
        filter (where accounts.verification_status = 'confirmed'))[1] as verified_by,
      max(accounts.verified_at) filter (where accounts.verification_status = 'confirmed') as verified_at
    from public.student_line_accounts as accounts
    join public.student_roster as roster on roster.student_number = accounts.student_number
    group by accounts.line_user_id
  )
  select
    ids.line_user_id,
    latest.display_name,
    aliases.alias_name,
    aliases.group_name,
    latest.message_at,
    latest.text,
    coalesce(accounts.registered_accounts, '[]'::jsonb),
    coalesce(accounts.system_verified, false),
    coalesce(evidence.review_status = 'pending', false),
    accounts.verified_by,
    accounts.verified_at,
    case
      when coalesce(accounts.system_verified, false) then 'system_registered'
      when evidence.review_status = 'pending' then 'pending'
      else 'other'
    end
  from contact_ids as ids
  left join latest_messages as latest on latest.line_user_id = ids.line_user_id
  left join public.line_user_aliases as aliases on aliases.line_user_id = ids.line_user_id
  left join account_summaries as accounts on accounts.line_user_id = ids.line_user_id
  left join public.line_link_evidence as evidence on evidence.line_user_id = ids.line_user_id
  order by coalesce(aliases.alias_name, latest.display_name, ids.line_user_id);
$$;

revoke all on function public.get_line_contact_admin_summaries() from public;
grant execute on function public.get_line_contact_admin_summaries() to service_role;

commit;
