import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
test('既存の宛先だけを職員が確認でき、根拠と変更前を保存し、履歴が失敗したら全体を戻す',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls');
 const base=fs.readFileSync('supabase/schema.sql','utf8');for(const table of ['line_messages','student_roster','student_line_links','student_line_accounts','line_user_aliases']){const m=base.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`));assert.ok(m,table);await db.exec(m[0]);}
 await db.exec(`create table line_link_evidence(line_user_id text primary key,review_status text,reviewed_at timestamptz,verified_at timestamptz,updated_at timestamptz);insert into student_roster(student_number,student_name,grade,homeroom_teacher) values('s','Sample','中1','Teacher');`);
 await db.exec(fs.readFileSync('supabase/line_contact_verification_20260829.sql','utf8'));
 const sql=fs.readFileSync('supabase/line_existing_contact_review_20261019.sql','utf8');await db.exec(sql);await db.exec(sql);
 const review=(id='line',relation='mother',note='電話で確認')=>db.query('select verify_existing_line_contact($1,$2,$3,$4,$5) result',[id,[{student_number:'s',relation,alias_name:'Sample mother',is_primary:false}],'Sample','Teacher',note]);
 await assert.rejects(review(),/登録済み/);await db.exec(`insert into student_line_accounts(student_number,line_user_id,verification_status,relation) values('s','line','unverified','unknown');`);
 await db.exec('set role anon');await assert.rejects(review(),/permission denied/);await db.exec('reset role');
 await assert.rejects(review('line','unknown'),/本人・続柄/);await assert.rejects(review('line','mother',''),/方法/);
 await db.exec(`create function audit_fail() returns trigger language plpgsql as $$begin raise exception 'audit failure'; end$$;create trigger fail before insert on line_contact_registration_events for each row execute function audit_fail()`);
 await assert.rejects(review(),/audit failure/);assert.equal((await db.query('select verification_status from student_line_accounts')).rows[0].verification_status,'unverified');await db.exec('drop trigger fail on line_contact_registration_events');
 await review();const row=(await db.query('select * from student_line_accounts')).rows[0];assert.equal(row.verification_status,'confirmed');assert.equal(row.relation,'mother');assert.equal(row.verified_by,'Teacher');assert.equal(row.evidence_message_id,null);
 const event=(await db.query('select * from line_contact_registration_events')).rows[0];assert.equal(event.evidence_text,'職員による本人確認：電話で確認');assert.equal(event.source,'post_interview_manual_review');assert.equal(event.previous_value.verification_status,'unverified');
 await db.exec(`update student_line_accounts set verification_status='revoked'`);await assert.rejects(review(),/登録済み/);
 }finally{await db.close();}
});
