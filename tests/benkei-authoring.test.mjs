import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
import {prepareAuthoring,saveAuthoring,processAuthoring,readAuthoring,BENKEI_INSERT_AFTER,authoringLink} from '../src/lib/benkei-authoring.mjs';
import {BENKEI_PAGE} from '../src/lib/benkei-core.mjs';
async function isolated(){
 const sql=new PGlite();
 await sql.exec(`create role anon;create role authenticated;create role service_role;create table staff_accounts(id uuid primary key,staff_code text,role text,active boolean);create function staff_authorize(uuid,uuid)returns jsonb language sql as $$select jsonb_build_object('staffId',id,'staffCode',staff_code,'role',role) from staff_accounts where id=$1 and active$$;`);
 await sql.exec(await readFile(new URL('../supabase/benkei_home_20261022.sql',import.meta.url),'utf8'));
 const authoring=await readFile(new URL('../supabase/benkei_authoring_20261022.sql',import.meta.url),'utf8');await sql.exec(authoring);await sql.exec(authoring);
 const actor=randomUUID(),other=randomUUID(),reader=randomUUID(),otherReader=randomUUID();
 await sql.query("insert into staff_accounts values($1,'KUDO','admin',true),($2,'KINJO','admin',true);",[actor,other]);
 await sql.query("insert into bentan_benkei_readers values($1,'検証用A',true),($2,'検証用B',true)",[reader,otherReader]);
 await sql.query('insert into bentan_benkei_reader_accounts values($1,$2),($3,$4)',[actor,reader,other,otherReader]);
 await sql.exec('update bentan_benkei_settings set enabled=true,trial_only=true');
 const db={async rpc(name,args={}){try{return {data:(await sql.query(`select ${name}(${Object.values(args).map((_,i)=>`$${i+1}`).join(',')}) result`,Object.values(args))).rows[0].result,error:null};}catch(error){return {data:null,error};}}};
 return {sql,db,identity:{authUserId:actor,authSessionId:randomUUID()},other:{authUserId:other,authSessionId:randomUUID()}};
}
function notionFixture(){
 const existing={object:'block',id:randomUUID(),type:'callout',has_children:false,callout:{rich_text:[{type:'text',text:{content:'既存の共有連絡'}}]},last_edited_time:new Date().toISOString()};
 const roots=[{id:BENKEI_INSERT_AFTER,type:'callout',has_children:false,callout:{rich_text:[]} },existing,{id:randomUUID(),type:'divider'}];const byId=new Map(roots.map(b=>[b.id,b]));const writes=[];
 let loseNextWrite=false,failNextWrite=null;
 const request=async(path,init={})=>{
  if(init.method==='PATCH'){
   writes.push({path,body:JSON.parse(init.body)});if(failNextWrite){const error=Object.assign(new Error('provider rejected'),{status:failNextWrite});failNextWrite=null;throw error;}
   let response;
   if(path===`/blocks/${BENKEI_PAGE}/children`){const payload=JSON.parse(init.body);assert.equal(payload.after,BENKEI_INSERT_AFTER);assert.equal(payload.children.length,1);const block={...payload.children[0],id:randomUUID(),has_children:false,last_edited_time:new Date().toISOString()};roots.splice(1,0,block);byId.set(block.id,block);response={results:[block]};}
   else{const id=path.split('/').at(-1),block=byId.get(id);assert.ok(block);Object.assign(block,JSON.parse(init.body));block.last_edited_time=new Date().toISOString();response=block;}
   if(loseNextWrite){loseNextWrite=false;throw new Error('response lost after successful write');}return response;
  }
  if(path.startsWith(`/blocks/${BENKEI_PAGE}/children`))return {results:roots,has_more:false};
  const block=byId.get(path.split('/').at(-1));if(!block)throw Object.assign(new Error('not found'),{status:404});return block;
 };
 return {request,writes,roots,existing,byId,lose(){loseNextWrite=true;},reject(status){failNextWrite=status;}};
}
const draft=()=>({action:'save',operationId:randomUUID(),kind:'create',title:'共有連絡の見出し',body:'面談をした生徒への授業での確認事項です。'});

test('APIのrich_text2000字/配列100件/UTF8容量を保存前に検証',()=>{
 const body=draft();const valid=prepareAuthoring({...body,body:'😀'.repeat(3000)});assert.ok(valid.create.children[0].callout.rich_text.every(part=>part.text.content.length<=2000));
 assert.throws(()=>prepareAuthoring({...body,title:'複数\n行'}));assert.throws(()=>prepareAuthoring({...body,body:'あ'.repeat(170000)}),/content_too_large/);assert.throws(()=>prepareAuthoring({...body,body:'a'.repeat(300000)}));
 assert.equal(valid.create.children.length,1);assert.equal(valid.create.after,BENKEI_INSERT_AFTER);
});

test('appから作成→Notion同原本→共有DB反映。再送は重複せず既存原本を変更しない',async()=>{
 const f=await isolated(),notion=notionFixture();try{
  const body=draft(),args={db:f.db,request:notion.request,identity:f.identity,body};
  const first=await saveAuthoring(args);assert.equal(first.operation.status,'synced');assert.equal(notion.writes.length,1);assert.deepEqual(notion.existing.callout.rich_text,[{type:'text',text:{content:'既存の共有連絡'}}]);
  const next=await saveAuthoring(args);assert.equal(next.operation.status,'synced');assert.equal(notion.writes.length,1);
  assert.equal((await f.sql.query('select count(*)::int n from bentan_benkei_authoring_operations')).rows[0].n,1);assert.equal((await f.sql.query('select count(*)::int n from bentan_benkei_items')).rows[0].n,1);
  const list=await readAuthoring({db:f.db,identity:f.identity});assert.equal(list.entries.length,1);assert.equal(list.entries[0].body,body.body);assert.ok(list.entries[0].sourceRef.includes(first.operation.sourceId.replaceAll('-','')));
  await assert.rejects(saveAuthoring({...args,body:{...body,body:'同じ操作番号の別内容'}}),/idempotency_conflict/);
  await assert.rejects(saveAuthoring({...args,identity:f.other,body:draft()}),/permission_denied/);
  const rights=(await f.sql.query("select has_table_privilege('anon','bentan_benkei_authoring_operations','select') a,has_function_privilege('authenticated','benkei_authoring_prepare(uuid,uuid,uuid,text,jsonb,text,text)','execute') b")).rows[0];assert.ok(Object.values(rights).every(value=>value===false));
 }finally{await f.sql.close();}
});

test('Notion保存成功後に応答が失われても原本リンクで復旧し、二回目の書込をしない',async()=>{
 const f=await isolated(),notion=notionFixture();try{
  const body=draft(),args={db:f.db,request:notion.request,identity:f.identity,body};notion.lose();
  const first=await saveAuthoring(args);assert.equal(first.operation.status,'unknown');assert.equal(notion.writes.length,1);
  await assert.rejects(saveAuthoring({...args,body:{...body,operationId:randomUUID()}}),/prior_result_unknown/);
  const recovered=await processAuthoring({db:f.db,request:notion.request,id:body.operationId,recoverOnly:true});assert.equal(recovered.status,'synced');assert.equal(notion.writes.length,1);
  assert.ok(notion.roots.some(block=>(block.callout?.rich_text??[]).some(part=>part.text?.link?.url===authoringLink(body.operationId))));
 }finally{await f.sql.close();}
});

test('app作成だけ編集可能。原文競合は保存拒否、子ブロック追加済みも保護する',async()=>{
 const f=await isolated(),notion=notionFixture();try{
  const created=await saveAuthoring({db:f.db,request:notion.request,identity:f.identity,body:draft()}),id=created.operation.sourceId;
  const current=(await readAuthoring({db:f.db,identity:f.identity})).entries[0];
  const edit={...draft(),kind:'edit',sourceId:id,expectedHash:current.sourceHash,body:'修正後の連絡です。'};
  const edited=await saveAuthoring({db:f.db,request:notion.request,identity:f.identity,body:edit});assert.equal(edited.operation.status,'synced');assert.equal(notion.writes.length,2);
  const conflict=await saveAuthoring({db:f.db,request:notion.request,identity:f.identity,body:{...edit,operationId:randomUUID(),body:'古い原文からの修正'}});assert.equal(conflict.operation.status,'conflict');assert.equal(notion.writes.length,2);
  await assert.rejects(saveAuthoring({db:f.db,request:notion.request,identity:f.identity,body:{...edit,operationId:randomUUID(),sourceId:notion.existing.id}}),/source_not_owned/);
  const latest=(await readAuthoring({db:f.db,identity:f.identity})).entries[0];notion.byId.get(id).type='paragraph';notion.byId.get(id).paragraph=notion.byId.get(id).callout;
  const structure=await saveAuthoring({db:f.db,request:notion.request,identity:f.identity,body:{...edit,operationId:randomUUID(),expectedHash:latest.sourceHash,body:'構造を変えずに保存'}});assert.equal(structure.operation.status,'conflict');assert.equal(structure.operation.errorCode,'source_structure_changed');assert.equal(notion.writes.length,2);
 }finally{await f.sql.close();}
});

test('結果不明で見つからない原本は再送しない。期限切れwritingも照合だけ',async()=>{
 const f=await isolated(),notion=notionFixture();try{
  const body=draft(),p=prepareAuthoring(body);await f.sql.query('select benkei_authoring_prepare($1,$2,$3,$4,$5,$6,$7)',[f.identity.authUserId,f.identity.authSessionId,p.id,p.kind,p.payload,p.requestHash,p.desiredHash]);
  const claimed=(await f.sql.query('select benkei_authoring_claim($1,false) result',[p.id])).rows[0].result;assert.equal(claimed.mode,'write');
  await f.sql.query("update bentan_benkei_authoring_operations set lease_until=now()-interval '1 second' where id=$1",[p.id]);
  const result=await processAuthoring({db:f.db,request:notion.request,id:p.id});assert.equal(result.status,'unknown');assert.equal(notion.writes.length,0);
  const again=await processAuthoring({db:f.db,request:notion.request,id:p.id,recoverOnly:true});assert.equal(again.status,'unknown');assert.equal(notion.writes.length,0);
 }finally{await f.sql.close();}
});
