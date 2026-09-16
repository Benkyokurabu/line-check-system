import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),actor=randomUUID(),user=randomUUID(),session=randomUUID();let student;
const original={title:'予約可',date:{start:'2026-12-01T13:00:00+09:00',end:'2026-12-01T13:45:00+09:00'},teachers:[],campuses:['本校'],room:'本①',tags:['本：予約可']};
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table staff_accounts(id uuid primary key,role text);
 create table student_registry(student_number text primary key,notion_page_id uuid,student_name text,grade text,updated_at timestamptz default now());
 create table lessons(id uuid primary key,updated_at timestamptz default now());
 create function staff_authorize(uuid,uuid,text,boolean) returns jsonb language sql as $$ select jsonb_build_object('staffId',id,'role',role) from staff_accounts limit 1 $$;`);
 await db.query("insert into staff_accounts values($1,'admin')",[actor]);
 await db.query("insert into student_registry(student_number,student_name,grade) values('fixture','検証生徒','中1')");
 for(const name of ['interviews_20260914','interview_student_identity_20260914','interview_bensuke_20260916'])await db.exec(await readFile(new URL(`../supabase/${name}.sql`,import.meta.url),'utf8'));
 student=(await db.query('select id from interview_students')).rows[0].id;
});
after(()=>db.close());
const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
const snapshot=()=>value('select interview_snapshot() v');
const binding=pageId=>({pageId,sourceId:'19ef0120-80a7-80c4-a965-000b104ea319',editedAt:'2026-09-16T00:00:00Z',baseline:original});
async function save(action,data,id=null,version=0,reason='変更',key=randomUUID()){
 return value('select interview_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) v',[user,session,key,await snapshot(),action,id,version,JSON.stringify(data),reason,'fixture']);
}
async function create(pageId=randomUUID()){return save('create',{studentId:student,date:'2026-12-01',bensuke:binding(pageId)});}
const claim=id=>value('select interview_sync_claim($1) v',[id]);
const stage=(id,lease,expected)=>db.query('select interview_bensuke_stage($1,$2,$3)',[id,lease,JSON.stringify(expected)]);
const finish=(id,lease,result)=>db.query('select interview_sync_finish($1,$2,$3)',[id,lease,JSON.stringify(result)]);
test('同じカードの二重受付をDB制約で拒否し、原本と関連付けを保存する',async()=>{
 const pageId=randomUUID(),a=await create(pageId);assert.equal(a.notion_page_id,pageId);assert.deepEqual(a.notion_original,original);
 await assert.rejects(()=>create(pageId),/unique/);
 await assert.rejects(()=>save('update',{studentId:student,bensuke:binding(randomUUID())},a.id,1),/immutable/);
});
test('同期の排他・期限切れの結果書込み拒否・反映不明時の変更拒否',async()=>{
 const a=await create();await save('confirm',a.data,a.id,1);const c=await claim(a.id);assert.ok(c.lease);
 await assert.rejects(()=>create(),/version_conflict/);
 await stage(a.id,c.lease,{...original,title:'面談'});
 await finish(a.id,c.lease,{status:'uncertain',message:'結果不明'});
 await assert.rejects(()=>save('cancel',{},a.id,2),/notion_sync_unresolved/);
 const next=await claim(a.id);assert.equal(next.notion_expected.title,'面談');
 await db.query("update interview_bookings set sync_lease_until=now()-interval '1 second' where id=$1",[a.id]);
 await assert.rejects(()=>finish(a.id,next.lease,{status:'synced',value:original,editedAt:'2026-09-16T01:00:00Z'}),/version_conflict/);
 const retry=await claim(a.id);await finish(a.id,retry.lease,{status:'synced',value:original,editedAt:'2026-09-16T01:00:00Z'});
});
test('取消の反映成功時だけ同じ予約可を再利用できる',async()=>{
 const pageId=randomUUID(),a=await create(pageId);await save('cancel',{},a.id,1);
 await assert.rejects(()=>create(pageId),/unique/);
 const c=await claim(a.id);await finish(a.id,c.lease,{status:'synced',value:original,editedAt:'2026-09-16T01:00:00Z'});
 const b=await create(pageId);assert.notEqual(b.id,a.id);assert.equal(await claim(a.id),null);
});
test('Notionの変更取り込みは認証・版・重複操作を確認し監査を残す',async()=>{
 const a=await create();await save('confirm',a.data,a.id,1);const c=await claim(a.id);
 await finish(a.id,c.lease,{status:'synced',value:original,editedAt:'2026-09-16T01:00:00Z'});
 const key=randomUUID(),snap=await snapshot(),data={...a.data,start:'14:00'},remote={...original,title:'変更済み'};
 const args=[user,session,key,snap,a.id,2,JSON.stringify(data),'Notionの変更を取り込み','hash',JSON.stringify(remote),'2026-09-16T02:00:00Z'];
 const sql='select interview_bensuke_adopt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) v';
 const result=await value(sql,args);assert.equal(result.version,3);assert.equal(result.notion_synced_version,3);assert.equal(result.data.start,'14:00');
 assert.deepEqual(await value(sql,args),result);
 const old=[...args];old[2]=randomUUID();await assert.rejects(()=>value(sql,old),/version_conflict/);
 await db.exec('set role anon');await assert.rejects(()=>value(sql,args),/permission denied/);await db.exec('reset role');
});
