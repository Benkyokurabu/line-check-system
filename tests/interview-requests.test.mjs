import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),actor=randomUUID(),user=randomUUID(),session=randomUUID(),hash='a'.repeat(64),line='U'+'1'.repeat(32);let student,other;
const date=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table staff_accounts(id uuid primary key,role text,staff_code text);
 create table student_registry(student_number text primary key,notion_page_id uuid,student_name text,grade text,homeroom_teacher text,enrollment_status text default 'current_roster',updated_at timestamptz default now());
 create table student_line_accounts(student_number text references student_registry(student_number),line_user_id text,relation text,verification_status text);
 create table lessons(id uuid primary key,updated_at timestamptz default now());
 create function staff_authorize(uuid,uuid,text,boolean) returns jsonb language sql as $$select jsonb_build_object('staffId',id,'role',role,'staffCode',staff_code) from staff_accounts limit 1$$;`);
 await db.query("insert into staff_accounts values($1,'admin','KUDO')",[actor]);
 await db.exec("insert into student_registry(student_number,student_name,grade,homeroom_teacher) values('one','架空生徒','中1','工藤'),('two','別の生徒','中2','工藤')");
 for(const file of ['interviews_20260914','interview_student_identity_20260914','interview_bensuke_20260916','interview_requests_20260916','interview_parent_cancel_20260918'])await db.exec(await readFile(new URL(`../supabase/${file}.sql`,import.meta.url),'utf8'));
 student=await value("select id v from interview_students where student_number='one'");other=await value("select id v from interview_students where student_number='two'");
 await db.query("insert into student_line_accounts values('one',$1,'mother','confirmed')",[line]);
 await db.query("insert into interview_parent_sessions(token_hash,line_user_id,expires_at) values($1,$2,now()+interval '1 hour')",[hash,line]);
});
after(()=>db.close());
const snapshot=()=>value('select interview_snapshot() v');
const publish=async(n=4)=>{
 const page=randomUUID(),data={studentId:'00000000-0000-4000-8000-000000000000',teacher:'工藤',date:date(n),start:'13:00',end:'13:45',busyStart:'13:00',busyEnd:'14:00',campus:'本校',room:'',method:'Zoom',purpose:'保護者面談',participants:'保護者',channel:'LINE',note:''};
 return value('select interview_publish_slot($1,$2,$3,$4,$5,$6,true) v',[user,session,randomUUID(),page,JSON.stringify(data),'2026-09-16T00:00:00Z']);
};
const submit=(ids,key=randomUUID(),id=student)=>value('select interview_parent_submit($1,$2,$3,$4,$5) v',[hash,key,id,ids,'相談']);
const withdraw=r=>value('select interview_parent_withdraw($1,$2,$3,$4) v',[hash,randomUUID(),r.id,r.version]);
async function approve(r,s,key=randomUUID()){
 const original={title:'予約可',date:{start:s.data.date+'T13:00:00+09:00',end:s.data.date+'T13:45:00+09:00'},teachers:[],campuses:['本校'],room:'',tags:['本：予約可']};
 const data={...s.data,studentId:r.student_id,bensuke:{pageId:s.notion_page_id,sourceId:'19ef0120-80a7-80c4-a965-000b104ea319',editedAt:s.notion_edited_at,baseline:original}};
 return value("select interview_review_request($1,$2,$3,$4,$5,'approve',$6,$7,$8,'',$9) v",[user,session,key,r.id,r.version,s.id,await snapshot(),JSON.stringify(data),'same-request']);
}
test('第3希望まで順序を保持し、未紐付け・重複・4希望・期限切れを拒否',async()=>{
 const slots=await Promise.all([publish(3),publish(4),publish(5)]);
 await assert.rejects(()=>submit([slots[0].id],randomUUID(),other),/parent_subject_denied/);
 await assert.rejects(()=>submit([slots[0].id,slots[0].id]),/invalid_choices/);
 await assert.rejects(()=>submit([...slots.map(s=>s.id),randomUUID()]),/invalid_choices/);
 const key=randomUUID(),r=await submit(slots.map(s=>s.id),key);
 assert.deepEqual(r.choices.map(c=>c.slotId),slots.map(s=>s.id));
 assert.deepEqual(await submit(slots.map(s=>s.id),key),r);
 await assert.rejects(()=>submit([slots[0].id]),/request_already_active/);
 await assert.rejects(()=>submit([slots[0].id],key),/idempotency_conflict/);
 await withdraw(r);
 await db.exec("update interview_parent_sessions set expires_at=now()-interval '1 minute'");
 await assert.rejects(()=>submit([slots[0].id]),/parent_session_required/);
 await db.exec("update interview_parent_sessions set expires_at=now()+interval '1 hour'");
});
test('確認済み紐づけの失効を再送でも確認する',async()=>{
 const s=await publish(6),key=randomUUID(),r=await submit([s.id],key);
 await db.exec("update student_line_accounts set verification_status='revoked'");
 await assert.rejects(()=>submit([s.id],key),/parent_subject_denied/);
 await db.exec("update student_line_accounts set verification_status='confirmed'");await withdraw(r);
});
test('第2希望を承認し、予約・履歴を一組作成。再送で重複しない',async()=>{
 const first=await publish(7),second=await publish(8),r=await submit([first.id,second.id]),key=randomUUID();
 const approved=await approve(r,second,key);assert.equal(approved.selected_slot_id,second.id);assert.equal(approved.status,'approved');
 const booking=await value('select to_jsonb(b) v from interview_bookings b where id=$1',[approved.booking_id]);
 assert.equal(booking.status,'confirmed');assert.equal(booking.data.method,'Zoom');assert.equal(booking.data.date,second.data.date);assert.equal(booking.notion_page_id,second.notion_page_id);assert.equal(booking.notion_synced_version,0);
 const again=await approve(r,second,key);assert.deepEqual(again,approved);
 assert.equal(await value('select count(*)::int v from interview_bookings where id=$1',[booking.id]),1);
 assert.equal(await value('select interview_slot_available($1,$2) v',[first.id,'工藤']),true);
 assert.equal(await value('select interview_slot_available($1,$2) v',[first.id,'金城']),false);
 const cancelled=await withdraw(approved);assert.equal(cancelled.booking.status,'cancelled');
 assert.equal(await value('select status v from interview_bookings where id=$1',[booking.id]),'cancelled');
 assert.equal(await value('select count(*)::int v from interview_events where booking_id=$1 and action=\'cancel\'',[booking.id]),1);
});
test('公開停止・変更後の古い希望・同枠の二重承認を拒否する',async()=>{
 const s=await publish(9),r=await submit([s.id]);
 await db.query('update interview_public_slots set published=false where id=$1',[s.id]);await assert.rejects(()=>approve(r,s),/slot_unavailable/);
 await db.query('update interview_public_slots set published=true,version=version+1 where id=$1',[s.id]);await assert.rejects(()=>approve(r,s),/slot_changed/);await withdraw(r);
 const current=await value('select to_jsonb(s) v from interview_public_slots s where id=$1',[s.id]);
 const one=await submit([s.id]);
 await db.query("insert into student_line_accounts values('two',$1,'father','confirmed')",[line]);
 const two=await submit([s.id],randomUUID(),other);await approve(one,current);
 await assert.rejects(()=>approve(two,current),/slot_unavailable/);await withdraw(two);
});
test('匿名・一般職員から申請や認証セッションにアクセスできない',async()=>{
 await db.exec('set role anon');await assert.rejects(()=>db.query('select * from interview_parent_requests'),/permission denied/);await assert.rejects(()=>db.query('select * from interview_parent_sessions'),/permission denied/);await assert.rejects(()=>db.query('select interview_slot_available($1,$2)',[randomUUID(),'工藤']),/permission denied/);await db.exec('reset role');
 await db.exec("update staff_accounts set staff_code='OTHER'");await assert.rejects(()=>publish(),/staff_permission_denied/);await db.exec("update staff_accounts set staff_code='KUDO'");
});
