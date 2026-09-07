import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { authorizeReservationSubject } from '../src/lib/reservation-access.mjs';
import { buildLineContactAlias } from '../src/lib/line-contact-registration.mjs';

test('a shared verified LINE identity remains explicitly shared', () => {
  const input={actorLineUserId:'shared',targetStudentNumber:'former',accounts:[{line_user_id:'shared',student_number:'former',relation:'shared',verification_status:'confirmed'}]};
  assert.deepEqual(authorizeReservationSubject(input),{allowed:true,reason:'confirmed_link',actingAs:'shared'});
  for(const verification_status of ['unverified','needs_review','revoked']) {
    assert.equal(authorizeReservationSubject({...input,accounts:[{...input.accounts[0],verification_status}]}).allowed,false);
  }
  assert.equal(buildLineContactAlias({student_name:'Test',campus:'本校'},'shared'),'本　Test　生徒・保護者共有');
});

test('former students retain shared contacts without entering teaching roster; migrations and registration are replay safe', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    const base = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
    for (const table of ['line_messages','student_roster','student_line_links','student_line_accounts','line_user_aliases']) {
      const definition = base.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`));
      assert.ok(definition, table);
      await db.exec(definition[0]);
    }
    await db.exec(`create table public.line_link_evidence(line_user_id text primary key,review_status text,reviewed_at timestamptz,verified_at timestamptz,updated_at timestamptz);
      insert into public.student_roster(student_number,student_name,grade,homeroom_teacher) values ('current','Current','中1','Teacher');
      insert into public.student_line_accounts(student_number,line_user_id) values ('current','existing');`);
    await db.exec(await readFile(new URL('../supabase/line_contact_verification_20260829.sql', import.meta.url),'utf8'));
    // Production may retain the older audit constraint even after shared account support.
    await db.exec("alter table public.line_contact_registration_events drop constraint line_contact_registration_events_relation_check; alter table public.line_contact_registration_events add constraint line_contact_registration_events_relation_check check(relation in ('student','mother','father','guardian','family','unknown')); ");
    const sql = await readFile(new URL('../supabase/student_registry_20260907.sql', import.meta.url),'utf8');
    const before = (await db.query('select * from public.student_roster')).rows;
    await db.exec(sql);
    const person = { student_number:'former',student_name:'Former',grade:'高1',campus:'本校',enrollment_status:'卒塾',notion_page_id:randomUUID() };
    const register = (p=person,line='shared-line',alias='Former shared') => db.query('select public.register_study_room_former_student($1,$2,$3,$4) result',[p,line,'Shared Profile',alias]);
    await db.exec('set role anon;');
    await assert.rejects(register(), /permission denied/);
    await assert.rejects(db.query('select * from public.student_registry'),/permission denied/);
    await db.exec('reset role;');
    await assert.rejects(register({...person,notion_page_id:null}), /identity required/);
    await assert.rejects(register(person,'existing'),/association requires review/);
    await db.exec(`create function public.test_audit_failure() returns trigger language plpgsql as $$begin raise exception 'audit unavailable'; end$$;
      create trigger test_audit_failure before insert on public.line_contact_registration_events for each row execute function public.test_audit_failure();`);
    await assert.rejects(register(),/audit unavailable/);
    assert.equal((await db.query("select count(*)::int n from public.student_registry where student_number='former'")).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int n from public.line_user_aliases where line_user_id='shared-line'")).rows[0].n,0);
    await db.exec('drop trigger test_audit_failure on public.line_contact_registration_events;');
    assert.equal((await register()).rows[0].result.already_registered,false);
    assert.deepEqual((await db.query('select * from public.student_roster')).rows,before);
    const a=(await db.query("select * from public.student_line_accounts where student_number='former'")).rows[0];
    assert.equal(a.relation,'shared'); assert.equal(a.is_primary,false); assert.equal(a.verification_status,'confirmed');
    assert.equal(a.evidence_message_id,null); assert.equal(a.verification_source,'user_instruction');
    assert.equal((await db.query("select * from public.student_line_links where student_number='former'")).rows.length,0);
    assert.equal((await db.query("select enabled from public.study_room_eligibilities where student_number='former'")).rows[0].enabled,true);
    assert.equal((await db.query("select enrollment_status from public.student_registry where student_number='former'")).rows[0].enrollment_status,'卒塾');
    const summary=(await db.query("select registered_accounts from public.get_line_contact_admin_summaries() where line_user_id='shared-line'")).rows[0];
    assert.equal(summary.registered_accounts[0].student_name,'Former');
    assert.equal(summary.registered_accounts[0].enrollment_status,'卒塾');
    assert.equal(summary.registered_accounts[0].study_room_enabled,true);
    assert.equal((await register()).rows[0].result.already_registered,true);
    assert.equal((await db.query("select count(*)::int n from public.line_contact_registration_events where student_number='former'")).rows[0].n,1);
    await assert.rejects(register({...person,student_name:'Different'}),/identity conflict/);
    await assert.rejects(register(person,'shared-line','Different alias'),/explicit update/);
    await db.exec(sql);
    assert.equal((await register()).rows[0].result.already_registered,true);
    const verifyDefinition=(await db.query("select pg_get_functiondef('public.verify_line_contact(text,jsonb,text,text,uuid,text)'::regprocedure) d")).rows[0].d;
    assert.match(verifyDefinition,/if target_is_primary and exists\(select 1 from public\.student_roster/);
    await db.exec("update public.student_roster set grade='中2' where student_number='current';");
    assert.equal((await db.query("select grade from public.student_registry where student_number='current'")).rows[0].grade,'中2');
    await assert.rejects(db.exec("insert into public.student_roster(student_number,student_name,grade,homeroom_teacher) values ('former','Former','高1','Teacher')"),/reconciliation required/);
    assert.equal((await db.query("select count(*)::int n from public.student_roster where student_number='former'")).rows[0].n,0);
    await assert.rejects(db.exec("delete from public.student_registry where student_number='former'"),/foreign key/);
    const fields=(await db.query("select column_name from information_schema.columns where table_name='study_room_eligibilities'")).rows.map(r=>r.column_name).sort();
    assert.deepEqual(fields,['created_at','enabled','student_number','updated_at']);
  } finally { await db.close(); }
});
