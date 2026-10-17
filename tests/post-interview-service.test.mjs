import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {savePostEntry} from '../src/lib/post-interview-service.mjs';
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
