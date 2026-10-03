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

test('availability reservations exclude other surveys and the original booking workflow',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role;create table interview_bookings(id uuid primary key,notion_page_id uuid);');
  await db.exec(await readFile(new URL('../supabase/survey_bensuke_20261003.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/survey_bensuke_availability_20261003.sql',import.meta.url),'utf8'));
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',page='33333333-3333-4333-8333-333333333333';
  const claim=async id=>(await db.query('select survey_bensuke_claim($1) r',[id])).rows[0].r;
  const x=await claim(a),y=await claim(b);
  await db.query('select survey_bensuke_reserve($1,$2,$3)',[a,x.lease,page]);
  await db.query('select survey_bensuke_reserve($1,$2,$3)',[a,x.lease,page]);
  await assert.rejects(()=>db.query('select survey_bensuke_reserve($1,$2,$3)',[b,y.lease,page]),/別の面談/);
  await assert.rejects(()=>db.query('insert into interview_bookings values($1,$2)',[b,page]),/アンケートの面談/);
  const other='44444444-4444-4444-8444-444444444444';await db.query('insert into interview_bookings values($1,$2)',[b,other]);
  await assert.rejects(()=>db.query('select survey_bensuke_reserve($1,$2,$3)',[a,x.lease,other]),/別の面談/);
  await assert.rejects(()=>db.query('select survey_bensuke_reserve($1,$2,$3)',[a,y.lease,other]),/有効期限/);
  await db.query('update interview_bookings set notion_page_id=null where id=$1',[b]);
  await db.query('select survey_bensuke_reserve($1,$2,$3)',[a,x.lease,other]);
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query('select * from survey_bensuke_reservations'),/permission denied/);await assert.rejects(()=>db.query('select survey_bensuke_reserve($1,$2,$3)',[a,x.lease,page]),/permission denied/);await db.exec('reset role');}
 }finally{await db.close();}
});
