import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Bensuke links are exclusive, durable, lease-protected and service-only',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role;');
  await db.exec(await readFile(new URL('../supabase/survey_bensuke_20261003.sql',import.meta.url),'utf8'));
  const id='11111111-1111-4111-8111-111111111111';
  const claim=async()=>((await db.query('select survey_bensuke_claim($1) r',[id])).rows[0].r);
  const a=await claim();await assert.rejects(()=>claim(),/保存中/);
  await db.query('select survey_bensuke_store($1,$2,$3,true)',[id,a.lease,JSON.stringify({state:'creating',expected:{title:'面談'}})]);
  const b=await claim();assert.equal(b.state,'creating');assert.equal(b.expected.title,'面談');
  await assert.rejects(()=>db.query("select survey_bensuke_store($1,$2,'{}',true)",[id,a.lease]),/有効期限/);
  await db.query("update survey_bensuke_links set lease_until=now()-interval '1 second'");
  await assert.rejects(()=>db.query("select survey_bensuke_store($1,$2,'{}',true)",[id,b.lease]),/有効期限/);
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>claim(),/permission denied/);await assert.rejects(()=>db.query('select * from survey_bensuke_links'),/permission denied/);await db.exec('reset role');}
 }finally{await db.close();}
});
