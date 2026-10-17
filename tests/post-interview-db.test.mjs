import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
test('工藤限定・応答喪失・版競合・同日別面談・lease・原本二重紐づけをDBで検証',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create table staff_accounts(id uuid primary key,staff_code text,role text,active boolean);create function staff_authorize(uuid,uuid,text,boolean)returns jsonb language sql as $$select jsonb_build_object('staffId',id,'staffCode',staff_code,'role',role) from staff_accounts where id=$1 and active$$;`);
  await db.exec(await readFile(new URL('../supabase/post_interview_20261017.sql',import.meta.url),'utf8'));
  const actor=randomUUID(),other=randomUUID(),student=randomUUID(),answer=randomUUID(),id=randomUUID(),operation=randomUUID(),session=randomUUID();await db.query("insert into staff_accounts values($1,'KUDO','admin',true),($2,'KINJO','admin',true)",[actor,other]);
  const payload={studentPageId:student,answerId:answer};const save=(entry=id,version=0,op=operation,who=actor,targets={record:{pageId:''},survey:{status:'pending'},lines:{}})=>db.query('select post_interview_entry_save($1,$2,$3,$4,$5,$6,$7,$8)',[who,session,op,entry,version,payload,targets,'f'.repeat(64)]);
  await save();await save();assert.equal((await db.query('select count(*)::int n from post_interview_entries')).rows[0].n,1);
  await assert.rejects(save(randomUUID(),0,randomUUID(),other),/permission/);await assert.rejects(save(id,0,randomUUID()),/conflict/);
  await save(randomUUID(),0,randomUUID());assert.equal((await db.query('select count(*)::int n from post_interview_entries')).rows[0].n,2);
  const claimed=(await db.query('select post_interview_entry_claim($1) row',[id])).rows[0].row;assert.equal(claimed.status,'running');assert.equal((await db.query('select post_interview_entry_claim($1) row',[id])).rows[0].row,null);
  await assert.rejects(save(id,1,randomUUID()),/conflict/);assert.equal((await db.query("select post_interview_entry_checkpoint($1,$2,'{}','complete') ok",[id,randomUUID()])).rows[0].ok,false);
  await db.query("select post_interview_entry_checkpoint($1,$2,'{}','review')",[id,claimed.lease]);await save(id,1,randomUUID(),actor,{record:{pageId:'same-record'}});
  await assert.rejects(save(randomUUID(),0,randomUUID(),actor,{record:{pageId:'same-record'}}),/unique/);
  const rights=(await db.query("select has_table_privilege('anon','post_interview_entries','select') a,has_table_privilege('authenticated','post_interview_entries','select') b,has_function_privilege('anon','post_interview_entry_claim(uuid)','execute') c")).rows[0];assert.ok(Object.values(rights).every(v=>v===false));
 }finally{await db.close();}
});
