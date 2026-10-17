import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
test('一回保存・応答喪失時の再送・版競合・排他・失効lease・権限をDBで検証',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create table staff_accounts(id uuid primary key,staff_code text,role text,active boolean);create function staff_authorize(uuid,uuid,text,boolean)returns jsonb language sql as $$select jsonb_build_object('staffId',id,'staffCode',staff_code,'role',role) from staff_accounts where id=$1 and active$$;`);
 await db.exec(await readFile(new URL('../supabase/enrollment_entry_20261017.sql',import.meta.url),'utf8'));
 const actor=randomUUID(),session=randomUUID(),id=randomUUID(),operation=randomUUID(),student=randomUUID();await db.query("insert into staff_accounts values($1,'KUDO','admin',true)",[actor]);
 const save=(version,op=operation,hash='f'.repeat(64))=>db.query('select enrollment_entry_save($1,$2,$3,$4,$5,$6,$7,$8) result',[actor,session,op,id,version,{studentPageId:student,fields:{}},{interview:{status:'pending'}},hash]);
 await save(0);await save(0);assert.equal((await db.query('select count(*)::int n from enrollment_entries')).rows[0].n,1);
 await assert.rejects(save(0,operation,'e'.repeat(64)),/conflict/);await assert.rejects(save(0,randomUUID()),/conflict/);
 const claim=(await db.query('select enrollment_entry_claim($1) result',[id])).rows[0].result;assert.ok(claim.lease);assert.equal((await db.query('select enrollment_entry_claim($1) result',[id])).rows[0].result,null);
 await assert.rejects(save(1,randomUUID()),/conflict/);
 assert.equal((await db.query("select enrollment_entry_checkpoint($1,$2,'{}','complete') ok",[id,randomUUID()])).rows[0].ok,false);
 assert.equal((await db.query("select enrollment_entry_checkpoint($1,$2,$3,'review') ok",[id,claim.lease,{interview:{status:'synced',pageId:randomUUID()}}])).rows[0].ok,true);
 await save(1,randomUUID());assert.equal((await db.query('select version from enrollment_entries')).rows[0].version,2);
 const again=(await db.query('select enrollment_entry_claim($1) result',[id])).rows[0].result;await db.query("update enrollment_entries set lease_until=now()-interval '1 second' where id=$1",[id]);const replacement=(await db.query('select enrollment_entry_claim($1) result',[id])).rows[0].result;assert.notEqual(again.lease,replacement.lease);
 assert.equal((await db.query("select enrollment_entry_checkpoint($1,$2,'{}','complete') ok",[id,again.lease])).rows[0].ok,false);
 await db.query("update staff_accounts set role='teacher' where id=$1",[actor]);await assert.rejects(save(2,randomUUID()),/permission/);
 await db.exec('set role anon');await assert.rejects(db.query('select * from enrollment_entries'),/permission/);await db.exec('reset role');
 }finally{await db.close();}
});
