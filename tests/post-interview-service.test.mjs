import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {savePostEntry,savePostLine,processPostEntry} from '../src/lib/post-interview-service.mjs';
import {preparePostContext} from '../src/lib/post-interview-notion.mjs';
import {blankPostFields,RECORD_SOURCE} from '../src/lib/post-interview-core.mjs';
const staff={staffId:randomUUID(),staffCode:'KUDO',role:'admin',displayName:'工藤'};
async function fixture(){
 const student=randomUUID(),answer=randomUUID(),record=randomUUID(),source=randomUUID(),teachers=randomUUID();let stored=null,event=null;
 const page={id:record,parent:{data_source_id:RECORD_SOURCE},properties:{面談内容:{type:'title',title:[{text:{content:'架空の相談'}}]},面談日:{type:'date',date:{start:'2026-10-17'}},生徒情報DB:{type:'relation',relation:[{id:student}]}}};
 const survey={id:answer,parent:{data_source_id:source},properties:{生徒情報DB:{type:'relation',relation:[{id:student}]},対応:{type:'select',select:{name:'未着手'}}}};
 const schema={properties:{面談内容:{type:'title'},面談日:{type:'date'},生徒情報DB:{type:'relation'},記入者:{type:'relation',relation:{data_source_id:teachers}}}};
 const verified={answer:survey,profile:{id:student},student:{student_number:'2026999',student_name:'架空の生徒',grade:'中３'},method:'３者Zoom'};
 const request=async path=>{if(path==='/data_sources/'+RECORD_SOURCE)return schema;if(path==='/data_sources/'+source)return {properties:{対応:{type:'select',select:{options:[{name:'対応済'},{name:'未着手'}]}}}};if(path==='/data_sources/'+RECORD_SOURCE+'/query')return {results:[page],has_more:false};if(path==='/data_sources/'+teachers+'/query')return {results:[],has_more:false};if(path==='/pages/'+record)return page;if(path.startsWith('/blocks/'+record+'/children'))return {results:[],has_more:false};throw Error('unexpected '+path);};
 const db={from:table=>{const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:table==='post_interview_entry_events'?event:stored,error:null})};return chain;},rpc:async(name,args)=>{assert.equal(name,'post_interview_entry_save');stored={id:args.p_id,version:args.p_version+1,answer_page_id:answer,student_page_id:student,payload:structuredClone(args.p_payload),targets:structuredClone(args.p_targets)};event={entry_id:stored.id,actor_id:staff.staffId,request_hash:args.p_hash};return {data:stored,error:null};}};
 const prepared=await preparePostContext({request,verified,recordId:record,staff});
 const fields=blankPostFields();for(const [key,value]of Object.entries({title:'架空の相談',date:'2026-10-17',record:'記録本文',summary:'共有内容'}))fields[key]={...fields[key],state:'confirmed',value};
 const body={id:randomUUID(),operationKey:randomUUID(),version:0,intent:'reflect',snapshot:prepared.snapshot,payload:{answerId:answer,studentPageId:student,recordPageId:record,sourceText:'原文',fields}};
 const args={db,request,body,context:{staff,identity:{authUserId:randomUUID(),authSessionId:randomUUID()}},verifyAnswer:async()=>verified,recipients:async()=>[{id:'mother',label:'母',verification:'confirmed',category:'guardian'}]};
 return {args,page,get stored(){return stored;},clearEvent(){event=null;}};
}
test('保存の再送は同じ案件を返し、原本競合・対象の付け替えは保存しない',async()=>{
 const f=await fixture();const saved=await savePostEntry(f.args);assert.equal(saved.version,1);assert.equal((await savePostEntry(f.args)).version,1);
 f.clearEvent();const next={...f.args.body,version:1,operationKey:randomUUID()};f.page.properties['面談内容'].title[0].text.content='原本の変更';
 await assert.rejects(()=>savePostEntry({...f.args,body:next}),/原本が更新/);
 await assert.rejects(()=>savePostEntry({...f.args,body:{...next,payload:{...next.payload,recordPageId:randomUUID()}}}),/付け替え/);
});
test('反映済みの内容を変えずに送信承認でき、確定者・確定日時を保持する',async()=>{
 const f=await fixture();const saved=await savePostEntry(f.args);saved.targets.record.status='synced';f.clearEvent();
 const payload=structuredClone(saved.payload);payload.fields.summary.value='確認後の共有文';
 const sent=await savePostEntry({...f.args,body:{...f.args.body,operationKey:randomUUID(),version:1,intent:'send',payload,deliveryApproval:[{id:'mother',text:'母宛ての確認済み本文'}]}});
 assert.equal(sent.targets.record.status,'synced');assert.equal(sent.targets.lines.mother.status,'pending');assert.equal(sent.payload.fields.title.confirmedAt,saved.payload.fields.title.confirmedAt);assert.equal(sent.payload.fields.title.confirmedBy,staff.staffId);
 f.clearEvent();sent.targets.lines.mother.status='sending';
 await assert.rejects(()=>savePostEntry({...f.args,body:{...f.args.body,operationKey:randomUUID(),version:2,payload:sent.payload}}),/送信処理中/);
});
test('未反映の内容から送信を承認できない',async()=>{const f=await fixture();await assert.rejects(()=>savePostEntry({...f.args,body:{...f.args.body,intent:'send',deliveryApproval:[{id:'mother',text:'本文'}]}}),/先に確定/);assert.equal(f.stored,null);});

test('直接送信はNotionの反映や共有文の確定を要求せず、同じ操作を重複保存しない',async()=>{
 const f=await fixture(),body={action:'send-line',id:f.args.body.id,operationKey:randomUUID(),version:0,answerId:f.args.body.payload.answerId,studentPageId:f.args.body.payload.studentPageId,deliveryApproval:[{id:'mother',text:'この本文を送る'}]};
 const args={...f.args,body,request:async()=>{throw Error('Notion must not be read');},recipients:async()=>[{id:'mother',label:'登録済みの母',verification:'unverified',category:'unknown'}]};
 const saved=await savePostLine(args);assert.equal(saved.targets.record.status,'skipped');assert.equal(saved.targets.lines.mother.independent,true);assert.equal(saved.payload.fields.summary.state,'unknown');
 assert.equal((await savePostLine(args)).version,1);assert.equal(f.stored.version,1);
 f.clearEvent();await assert.rejects(()=>savePostLine({...args,body:{...body,version:1,studentPageId:randomUUID(),operationKey:randomUUID()}}),/更新/);
});

test('直接送信は保存済み原文・確定者・反映待ちの記録を変更しない',async()=>{
 const f=await fixture(),saved=await savePostEntry(f.args),before=structuredClone(saved);f.clearEvent();
 const body={action:'send-line',id:saved.id,operationKey:randomUUID(),version:1,answerId:saved.answer_page_id,studentPageId:saved.student_page_id,deliveryApproval:[{id:'mother',text:'別のLINE本文'}]};
 const sent=await savePostLine({...f.args,body});
 assert.deepEqual(sent.payload.fields,before.payload.fields);assert.equal(sent.payload.sourceText,before.payload.sourceText);assert.deepEqual(sent.targets.record,before.targets.record);assert.deepEqual(sent.targets.survey,before.targets.survey);
});

test('直接送信はNotion障害から独立し、実行直前に紐づけ解除された宛先には送らない',async()=>{
 for(const linked of [true,false]){
  const entry={id:randomUUID(),lease:randomUUID(),version:1,payload:{studentNumber:'2026999',actorName:'工藤',intent:'reflect',fields:blankPostFields()},targets:{record:{status:'pending'},survey:{status:'pending'},lines:{mother:{id:'mother',key:randomUUID(),text:'本文',independent:true,status:'pending'}}}};
  let sends=0,notion=0;const db={rpc:async(name,args)=>({data:name==='post_interview_entry_claim'?entry:true}),from:()=>{const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:null}),insert:async()=>({error:null})};return chain;}};
  await processPostEntry({db,id:entry.id,lineOnly:true,request:async()=>{notion++;throw Error('Notion unavailable');},recipients:async()=>linked?[{id:'mother',verification:'unverified',category:'unknown'}]:[],lineToken:'test-only',fetcher:async()=>{sends++;return {ok:true,status:200,headers:new Headers()};}});
  assert.equal(notion,0);assert.equal(sends,linked?1:0);assert.equal(entry.targets.lines.mother.status,linked?'accepted':'review');assert.equal(entry.targets.record.status,'pending');
 }
});
