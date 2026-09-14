import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),actor=randomUUID(),user=randomUUID(),session=randomUUID();let student;
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table staff_accounts(id uuid primary key,role text);
 create table student_registry(student_number text primary key,notion_page_id uuid,student_name text,grade text,updated_at timestamptz default now());
 create table lessons(id uuid primary key,updated_at timestamptz default now());
 create function staff_authorize(uuid,uuid,text,boolean) returns jsonb language sql as $$ select jsonb_build_object('staffId',id,'role',role) from staff_accounts limit 1 $$;`);
 await db.query('insert into staff_accounts values($1,\'admin\')',[actor]);
 await db.query("insert into student_registry(student_number,student_name,grade) values ('test','架空の生徒','中1')");
 await db.exec(await readFile(new URL('../supabase/interviews_20260914.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/interview_student_identity_20260914.sql',import.meta.url),'utf8'));
 student=(await db.query('select id from interview_students')).rows[0].id;
});
after(()=>db.close());
async function snapshot(){return (await db.query('select interview_snapshot() s')).rows[0].s;}
async function save(action,data,id=null,version=0,reason='',snap=null,key=randomUUID(),hash='fixture'){
 return (await db.query('select interview_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[user,session,key,snap??await snapshot(),action,id,version,JSON.stringify(data),reason,hash])).rows[0].value;
}
test('登録は承認待ち、実生徒情報をサーバー補完、履歴と不変IDを保持',async()=>{
 const r=await save('create',{studentId:student,studentName:'偽名',date:'2026-11-02',start:'13:00'});
 assert.equal(r.status,'pending');assert.equal(r.data.studentName,'架空の生徒');assert.equal(r.student_id,student);
 const e=await db.query('select count(*)::int n from interview_events where booking_id=$1',[r.id]);assert.equal(e.rows[0].n,1);
});
test('同時に開いた古い画面からの保存を拒否',async()=>{
 const s=await snapshot();await save('create',{studentId:student});
 await assert.rejects(()=>save('create',{studentId:student},null,0,'',s),/version_conflict/);
});
test('応答を失った再試行は1件、同じ番号の別内容は拒否',async()=>{
 const key=randomUUID(),s=await snapshot(),data={studentId:student};
 const a=await save('create',data,null,0,'',s,key),b=await save('create',data,null,0,'',s,key);
 assert.equal(a.id,b.id);assert.deepEqual(a,b);
 await assert.rejects(()=>save('create',{...data,note:'違う内容'},null,0,'',s,key),/idempotency_conflict/);
});
test('承認・変更・取消には版確認、取消は理由必須で履歴維持',async()=>{
 const a=await save('create',{studentId:student});const b=await save('confirm',a.data,a.id,1);assert.equal(b.status,'confirmed');
 await assert.rejects(()=>save('cancel',{},a.id,1,'取消'),/version_conflict/);
 await assert.rejects(()=>save('cancel',{},a.id,2),/reason_required/);
 const c=await save('cancel',{},a.id,2,'希望変更');assert.equal(c.status,'cancelled');
 await assert.rejects(()=>save('update',{studentId:student},a.id,3,'復活'),/invalid_state_transition/);
});
test('授業・台帳更新でも古い照合結果を無効化',async()=>{
 const s=await snapshot();await db.query('insert into lessons(id) values($1)',[randomUUID()]);
 await assert.rejects(()=>save('create',{studentId:student},null,0,'',s),/version_conflict/);
});
test('一般講師による承認と匿名アクセスを拒否',async()=>{
 await db.exec("update staff_accounts set role='teacher'");
 await assert.rejects(()=>save('create',{studentId:student}),/staff_permission_denied/);
 await db.exec("update staff_accounts set role='admin';set role anon");
 await assert.rejects(()=>db.query('select * from interview_bookings'),/permission denied/);
 await assert.rejects(()=>db.query('select interview_snapshot()'),/permission denied/);
 await db.exec('reset role');
});
test('非公開にした枠と設定変更は履歴・版を更新し、予約には遡及しない',async()=>{
 const old=await snapshot();await save('slot',{key:'2030-01-01|teacher|本校|13:00',hidden:true});
 assert.notEqual(await snapshot(),old);
 assert.equal((await db.query('select data from interview_slot_overrides')).rows[0].data.hidden,true);
 const before=(await db.query('select count(*)::int n from interview_bookings')).rows[0].n;
 await save('settings',{duration:30});
 assert.equal((await db.query('select count(*)::int n from interview_bookings')).rows[0].n,before);
});
test('実施済み記録の編集と確定後の理由・版履歴を保持',async()=>{
 const a=await save('create',{studentId:student});await save('confirm',a.data,a.id,1);
 const completed=await save('complete',{content:'下書き',state:'draft'},a.id,2);
 assert.equal(completed.data.record.content,'下書き');
 const final=await save('record',{content:'確認済み',state:'final'},a.id,3);assert.equal(final.data.record.state,'final');
 await assert.rejects(()=>save('record',{content:'修正版',state:'final'},a.id,4),/reason_required/);
 const revision=await save('record',{content:'修正版',state:'final'},a.id,4,'誤字訂正');assert.equal(revision.version,5);
});
test('同期中の変更を拒否し、通信結果不明の新規カードを再作成しない',async()=>{
 const a=await save('create',{studentId:student});await save('confirm',a.data,a.id,1);
 const claim=(await db.query('select interview_sync_claim($1) b',[a.id])).rows[0].b;assert.ok(claim.lease);
 await assert.rejects(()=>save('cancel',{},a.id,2,'希望変更'),/version_conflict/);
 assert.equal((await db.query('select interview_sync_claim($1) b',[a.id])).rows[0].b,null);
 await db.query("update interview_bookings set sync_lease_until=now()-interval '1 minute' where id=$1",[a.id]);
 const next=(await db.query('select interview_sync_claim($1) b',[a.id])).rows[0].b;assert.equal(next.sync_error,'create_uncertain');
});

test('台帳への新規追加と既存形式のupsertが同じ不変IDに自動追従',async()=>{
 await db.query("insert into student_registry(student_number,student_name,grade) values('new','追加生徒','中2')");
 const a=(await db.query("select * from interview_students where student_number='new'")).rows[0];assert.ok(a.id);
 await db.query("insert into student_registry(student_number,student_name,grade) values('new','追加生徒（修正）','中3') on conflict(student_number) do update set student_name=excluded.student_name,grade=excluded.grade");
 const b=await save('create',{studentId:a.id});assert.equal(b.data.studentName,'追加生徒（修正）');assert.equal(b.student_id,a.id);
});

test('学籍番号とNotionページ変更後も同じ履歴を維持し、旧画面の保存は拒否',async()=>{
 const a=await save('create',{studentId:student}),old=await snapshot(),notion=randomUUID();
 await db.query("update student_registry set student_number='renumbered',notion_page_id=$1 where student_number='test'",[notion]);
 await assert.rejects(()=>save('create',{studentId:student},null,0,'',old),/version_conflict/);
 const b=await save('create',{studentId:student});assert.equal(b.student_id,a.student_id);assert.equal(b.data.studentNumber,'renumbered');
 const identity=(await db.query('select * from interview_students where id=$1',[student])).rows[0];assert.equal(identity.notion_page_id,notion);
 assert.equal((await db.query('select data from interview_bookings where id=$1',[a.id])).rows[0].data.studentNumber,'test');
});

test('台帳削除後の番号再利用は別人のIDになり、過去の面談を引き継がない',async()=>{
 const oldStudent=(await db.query("select id from interview_students where student_number='new'")).rows[0].id;
 const booking=await save('create',{studentId:oldStudent});
 await db.query("delete from student_registry where student_number='new'");
 await db.query("insert into student_registry(student_number,student_name,grade) values('new','別の生徒','中1')");
 const newStudent=(await db.query("select id from interview_students where student_number='new'")).rows[0].id;
 assert.notEqual(oldStudent,newStudent);
 await assert.rejects(()=>save('create',{studentId:oldStudent}),/student_missing/);
 const oldIdentity=(await db.query('select * from interview_students where id=$1',[oldStudent])).rows[0];
 assert.ok(oldIdentity.retired_at);assert.equal(oldIdentity.last_student_number,'new');
 assert.equal((await db.query('select student_id from interview_bookings where id=$1',[booking.id])).rows[0].student_id,oldStudent);
});

test('不変IDの差し替えと退役IDの再利用を拒否し、再適用でIDが変わらない',async()=>{
 await assert.rejects(()=>db.query("update student_registry set interview_student_id=$1 where student_number='new'",[randomUUID()]),/student_identity_immutable/);
 const retired=(await db.query('select id from interview_students where retired_at is not null')).rows[0].id;
 await assert.rejects(()=>db.query("insert into student_registry(student_number,interview_student_id) values('forged',$1)",[retired]),/student_identity_already_used/);
 await db.exec(await readFile(new URL('../supabase/interview_student_identity_20260914.sql',import.meta.url),'utf8'));
 assert.equal((await db.query("select interview_student_id from student_registry where student_number='renumbered'")).rows[0].interview_student_id,student);
});
