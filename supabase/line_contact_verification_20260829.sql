-- Human-reviewed LINE contact registration and audit trail.
-- Existing rows remain usable and are deliberately marked unverified until a staff member
-- confirms them from a LINE message in the application.

alter table public.student_line_accounts
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_by text,
  add column if not exists verified_at timestamptz,
  add column if not exists evidence_message_id uuid references public.line_messages (id) on delete set null,
  add column if not exists verification_source text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'student_line_accounts_verification_status_check'
      and conrelid = 'public.student_line_accounts'::regclass
  ) then
    alter table public.student_line_accounts
      add constraint student_line_accounts_verification_status_check
      check (verification_status in ('unverified', 'confirmed', 'needs_review', 'revoked'));
  end if;
end $$;

create index if not exists student_line_accounts_verification_idx
  on public.student_line_accounts (verification_status, verified_at desc);

create table if not exists public.line_contact_registration_events (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  student_number text references public.student_roster (student_number) on delete set null,
  action text not null,
  relation text,
  alias_name text,
  friend_display_name text,
  evidence_message_id uuid references public.line_messages (id) on delete set null,
  evidence_text text,
  performed_by text not null,
  source text not null default 'system_review',
  previous_value jsonb,
  created_at timestamptz not null default now(),
  constraint line_contact_registration_events_action_check
    check (action in ('confirmed', 'updated', 'revoked')),
  constraint line_contact_registration_events_relation_check
    check (relation is null or relation in ('student', 'mother', 'father', 'guardian', 'family', 'unknown'))
);

create index if not exists line_contact_registration_events_line_user_idx
  on public.line_contact_registration_events (line_user_id, created_at desc);

create index if not exists line_contact_registration_events_student_idx
  on public.line_contact_registration_events (student_number, created_at desc);

create table if not exists public.line_alias_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_name text,
  performed_by text,
  imported_count integer not null default 0,
  already_applied_count integer not null default 0,
  skipped_stale_count integer not null default 0,
  skipped_conflict_count integer not null default 0,
  skipped_unmatched_count integer not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.verify_line_contact(
  p_line_user_id text,
  p_targets jsonb,
  p_friend_display_name text,
  p_verified_by text,
  p_evidence_message_id uuid default null,
  p_source text default 'system_review'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target jsonb;
  target_count integer;
  target_student_number text;
  target_relation text;
  target_alias_name text;
  target_is_primary boolean;
  first_alias_name text;
  evidence_text_snapshot text;
  previous_account jsonb;
  event_action text;
  now_value timestamptz := now();
begin
  p_line_user_id := btrim(coalesce(p_line_user_id, ''));
  p_verified_by := btrim(coalesce(p_verified_by, ''));
  p_friend_display_name := nullif(btrim(coalesce(p_friend_display_name, '')), '');
  p_source := coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'system_review');

  if p_line_user_id = '' or length(p_line_user_id) > 255 then
    raise exception 'LINE user ID is required';
  end if;
  if p_verified_by = '' or length(p_verified_by) > 100 then
    raise exception '確認者名を入力してください';
  end if;
  if jsonb_typeof(p_targets) <> 'array' then
    raise exception '登録対象が不正です';
  end if;

  target_count := jsonb_array_length(p_targets);
  if target_count < 1 or target_count > 10 then
    raise exception '登録対象は1件から10件にしてください';
  end if;

  if p_evidence_message_id is not null then
    select left(coalesce(messages.text, ''), 2000)
      into evidence_text_snapshot
    from public.line_messages as messages
    where messages.id = p_evidence_message_id
      and messages.line_user_id = p_line_user_id;
    if not found then
      raise exception '確認メッセージがこのLINEアカウントのものではありません';
    end if;
  end if;

  for target in select value from jsonb_array_elements(p_targets)
  loop
    target_student_number := btrim(coalesce(target ->> 'student_number', ''));
    target_relation := coalesce(nullif(btrim(coalesce(target ->> 'relation', '')), ''), 'guardian');
    target_alias_name := btrim(coalesce(target ->> 'alias_name', ''));
    target_is_primary := coalesce((target ->> 'is_primary')::boolean, target_relation = 'student');

    if target_student_number = '' or not exists (
      select 1 from public.student_roster where student_number = target_student_number
    ) then
      raise exception '生徒が見つかりません: %', target_student_number;
    end if;
    if target_relation not in ('student', 'mother', 'father', 'guardian', 'family', 'unknown') then
      raise exception '続柄が不正です';
    end if;
    if target_alias_name = '' or length(target_alias_name) > 200 then
      raise exception '登録名が不正です';
    end if;

    select to_jsonb(accounts)
      into previous_account
    from public.student_line_accounts as accounts
    where accounts.student_number = target_student_number
      and accounts.line_user_id = p_line_user_id;

    event_action := case when previous_account is null then 'confirmed' else 'updated' end;

    insert into public.student_line_accounts (
      student_number, line_user_id, relation, alias_name, friend_display_name,
      source, is_primary, verification_status, verified_by, verified_at,
      evidence_message_id, verification_source, updated_at
    ) values (
      target_student_number, p_line_user_id, target_relation, target_alias_name,
      p_friend_display_name, 'manual', target_is_primary, 'confirmed', p_verified_by,
      now_value, p_evidence_message_id, p_source, now_value
    )
    on conflict (student_number, line_user_id) do update set
      relation = excluded.relation,
      alias_name = excluded.alias_name,
      friend_display_name = excluded.friend_display_name,
      source = excluded.source,
      is_primary = excluded.is_primary,
      verification_status = excluded.verification_status,
      verified_by = excluded.verified_by,
      verified_at = excluded.verified_at,
      evidence_message_id = excluded.evidence_message_id,
      verification_source = excluded.verification_source,
      updated_at = excluded.updated_at;

    if target_is_primary then
      insert into public.student_line_links (student_number, line_user_id, updated_at)
      values (target_student_number, p_line_user_id, now_value)
      on conflict (student_number) do update set
        line_user_id = excluded.line_user_id,
        updated_at = excluded.updated_at;
    end if;

    insert into public.line_contact_registration_events (
      line_user_id, student_number, action, relation, alias_name,
      friend_display_name, evidence_message_id, evidence_text,
      performed_by, source, previous_value, created_at
    ) values (
      p_line_user_id, target_student_number, event_action, target_relation,
      target_alias_name, p_friend_display_name, p_evidence_message_id,
      evidence_text_snapshot, p_verified_by, p_source, previous_account, now_value
    );

    if first_alias_name is null then first_alias_name := target_alias_name; end if;
  end loop;

  insert into public.line_user_aliases (line_user_id, alias_name, updated_at)
  values (p_line_user_id, first_alias_name, now_value)
  on conflict (line_user_id) do update set
    alias_name = excluded.alias_name,
    updated_at = excluded.updated_at;

  update public.line_link_evidence
  set review_status = 'confirmed', reviewed_at = now_value,
      verified_at = now_value, updated_at = now_value
  where line_user_id = p_line_user_id;

  return jsonb_build_object(
    'ok', true,
    'registered_count', target_count,
    'line_user_id', p_line_user_id,
    'verified_at', now_value
  );
end;
$$;

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

revoke all on function public.verify_line_contact(text, jsonb, text, text, uuid, text) from public;
grant execute on function public.verify_line_contact(text, jsonb, text, text, uuid, text) to service_role;
revoke all on function public.get_line_contact_admin_summaries() from public;
grant execute on function public.get_line_contact_admin_summaries() to service_role;
