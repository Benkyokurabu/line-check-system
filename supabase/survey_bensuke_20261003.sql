create table if not exists public.survey_bensuke_links (
 answer_id uuid primary key,
 page_id uuid unique,
 baseline jsonb,
 expected jsonb,
 state text not null default 'new' check (state in ('new','creating','updating','saved','synced')),
 lease uuid,
 lease_until timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.survey_bensuke_links enable row level security;
revoke all on public.survey_bensuke_links from public,anon,authenticated;
grant select,insert,update on public.survey_bensuke_links to service_role;

create or replace function public.survey_bensuke_claim(p_answer uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r survey_bensuke_links;
begin
 insert into survey_bensuke_links(answer_id) values(p_answer) on conflict do nothing;
 select * into r from survey_bensuke_links where answer_id=p_answer for update;
 if r.lease_until>now() then raise exception '面談日の保存中です。少し待って再試行してください。' using errcode='PT409'; end if;
 update survey_bensuke_links set lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
 where answer_id=p_answer returning * into r;
 return to_jsonb(r);
end $$;

create or replace function public.survey_bensuke_store(p_answer uuid,p_lease uuid,p_value jsonb,p_release boolean default false) returns void
language plpgsql security definer set search_path=public as $$
begin
 update survey_bensuke_links set
 page_id=case when p_value ? 'page_id' then (p_value->>'page_id')::uuid else page_id end,
 baseline=case when p_value ? 'baseline' then p_value->'baseline' else baseline end,
 expected=case when p_value ? 'expected' then p_value->'expected' else expected end,
 state=coalesce(p_value->>'state',state),
 lease_until=case when p_release then null else lease_until end,
 lease=case when p_release then null else lease end,updated_at=now()
 where answer_id=p_answer and lease=p_lease and lease_until>now();
 if not found then raise exception '保存の有効期限が切れました。最新情報を確認してください。' using errcode='PT409'; end if;
end $$;
revoke all on function public.survey_bensuke_claim(uuid),public.survey_bensuke_store(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.survey_bensuke_claim(uuid),public.survey_bensuke_store(uuid,uuid,jsonb,boolean) to service_role;
