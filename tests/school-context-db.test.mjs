import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
import {lineRecord,proposalForRecord} from '../src/lib/school-context-core.mjs';
test('隔離DBで原文版保存・検索・出典・保留再浮上防止・監査・非公開権限を検証',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create table staff_accounts(id uuid primary key,staff_code text,role text,active boolean);create function staff_authorize(uuid,uuid)returns jsonb language sql as $$select jsonb_build_object('staffId',id,'staffCode',staff_code,'role',role) from staff_accounts where id=$1 and active$$;`);
  const schema=await readFile(new URL('../supabase/school_context_20261022.sql',import.meta.url),'utf8');await db.exec(schema);await db.exec(schema);
  const actor=randomUUID(),other=randomUUID(),session=randomUUID();await db.query("insert into staff_accounts values($1,'KUDO','admin',true),($2,'KINJO','admin',true)",[actor,other]);
  const record=lineRecord({id:randomUUID(),line_user_id:'U1',text:'生徒の面談を相談したい',direction:'inbound',created_at:new Date().toISOString()},[{line_user_id:'U1',student_number:'123',verification_status:'confirmed'}]);
  const ingest=r=>db.query('select school_context_ingest($1,$2)',[r,proposalForRecord(r)]);
  await ingest(record);await ingest(record);assert.equal((await db.query('select count(*)::int n from school_context_records')).rows[0].n,1);
  const read=async(view='summary',query='',student='',who=actor)=>(await db.query('select school_context_read($1,$2,$3,$4,$5,20) result',[who,session,view,query,student])).rows[0].result;
  const summary=await read();assert.equal(summary.records.length,1);assert.equal(summary.proposals.length,1);assert.equal(summary.summary.pendingSources,0);
  assert.equal((await read('search','面談','123')).records.length,1);assert.equal((await read('search','面談','unmatched')).records.length,0);
  assert.equal((await read('search','%')).records.length,0);await assert.rejects(read('summary','','',other),/permission/);
  const id=summary.proposals[0].id;await db.query("select school_context_decide($1,$2,$3,'held','事情確認待ち')",[actor,session,id]);
  await db.query("select school_context_decide($1,$2,$3,'held','再送')",[actor,session,id]);
  const newer={...record,version:'new-version',text:'追加の面談相談'};await ingest(newer);
  assert.equal((await db.query('select count(*)::int n from school_context_records')).rows[0].n,2);
  const next=await read();assert.equal(next.proposals.length,0);assert.equal(next.records[0].version,'new-version');
  const proposals=(await read('proposals')).proposals;assert.equal(proposals.length,1);assert.equal(proposals[0].status,'held');assert.equal(proposals[0].decisions.length,1);assert.equal(proposals[0].evidence_stale,true);
  assert.equal(proposals[0].evidence[0].version,record.version);
  const decide=decision=>db.query('select school_context_decide($1,$2,$3,$4,\'検証\')',[actor,session,id,decision]);
  await assert.rejects(decide('accepted'),/context_evidence_stale/);
  await db.query('update school_context_sources set last_version=$1 where source_key=$2',[record.version,record.sourceKey]);
  for(const status of ['unavailable','refreshing','needs_refresh','needs_verification']){
   await db.query('update school_context_sources set status=$1 where source_key=$2',[status,record.sourceKey]);
   await assert.rejects(decide('accepted'),/context_evidence_stale/);
  }
  await decide('dismissed');await decide('held');
  await db.query("update school_context_sources set status='available' where source_key=$1",[record.sourceKey]);await decide('accepted');
  const missing={...record,sourceKey:'missing:source'};await db.query('update school_context_proposals set evidence=$1 where id=$2',[[{sourceKey:missing.sourceKey,version:record.version}],id]);await assert.rejects(decide('accepted'),/context_evidence_stale/);await decide('held');
  const rights=(await db.query("select has_table_privilege('anon','school_context_records','select') a,has_table_privilege('authenticated','school_context_records','select') b,has_function_privilege('anon','school_context_ingest(jsonb,jsonb)','execute') c,has_function_privilege('authenticated','school_context_read(uuid,uuid,text,text,text,integer)','execute') d")).rows[0];assert.ok(Object.values(rights).every(v=>v===false));
  await db.exec('set role anon');await assert.rejects(db.query('select * from school_context_records'),/permission/);await db.exec('reset role');
 }finally{await db.close();}
});
