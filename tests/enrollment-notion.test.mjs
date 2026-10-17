import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {ENROLLMENT_SOURCES as sources,blankEnrollmentFields} from '../src/lib/enrollment-core.mjs';
import {runEnrollmentEntry,propertyBaseline} from '../src/lib/enrollment-notion.mjs';
function fixture(){
 const schema=(properties)=>({properties:Object.fromEntries(Object.entries(properties).map(([name,type])=>[name,{id:name,type,...(type==='select'?{select:{options:['３者対面','中２','在塾','入塾手続き完了'].map(n=>({id:n,name:n}))}}:type==='multi_select'?{multi_select:{options:['入会手続き','本校'].map(n=>({id:n,name:n}))}}:{})}]))});
 const schemas={student:schema({'本当の入塾日':'date','入塾手続日':'date'}),intake:schema({'入塾手続き日':'date'}),interview:schema({'面談内容':'title','生徒情報DB':'relation','面談日':'date','方法':'select','面談時の学年':'select','記入者':'relation','面談目的':'multi_select'}),mtg:schema({'内容':'title','生徒名':'relation','報告者':'relation','日付':'date','面談日':'date','方法':'select','面談時の学年':'select','面談目的':'multi_select','見出し':'rich_text','校舎':'multi_select'})};
 const pages=new Map(),blocks=new Map(),calls=[];let failCreate='';
 const make=(kind,props={},children=[])=>{const id=randomUUID();const p={id,parent:{data_source_id:sources[kind]},url:'https://notion.so/'+id,properties:{}};for(const [k,v]of Object.entries(props))p.properties[k]={...v,type:schemas[kind].properties[k]?.type};pages.set(id,p);blocks.set(id,children);return p;};
 const student=make('student',{'本当の入塾日':{date:{start:'2026-10-15'}}}),intake=make('intake');
 const fields=blankEnrollmentFields();for(const row of Object.values(fields))row.state='not_applicable';
 for(const [key,value]of Object.entries({admissionDate:'2026-10-20',procedureDate:'2026-10-17',interviewDate:'2026-10-17',method:'３者対面',grade:'中２',campus:'本校'}))fields[key]={value,state:'confirmed',reason:'',source:'職員入力',candidates:[]};
 const entry={id:randomUUID(),student_page_id:student.id,version:1,payload:{studentPageId:student.id,intakePageId:intake.id,record:'入塾手続きを行った。教材は次回配布する。',fields,actorPageId:randomUUID(),actorIssue:''},targets:Object.fromEntries(['interview','student','intake','mtg'].map(k=>[k,{status:'pending',pageId:k==='student'?student.id:k==='intake'?intake.id:null,baseline:k==='student'?propertyBaseline(student):{}}]))};
 const request=async(path,init={})=>{
  const method=init.method??'GET',body=init.body?JSON.parse(init.body):null;calls.push({path,method,body});
  const source=Object.entries(sources).find(([,v])=>path===`/data_sources/${v}`)?.[0];if(source)return structuredClone(schemas[source]);
  const query=Object.entries(sources).find(([,v])=>path===`/data_sources/${v}/query`)?.[0];if(query)return {results:[...pages.values()].filter(p=>p.parent.data_source_id===sources[query]),has_more:false};
  if(path==='/pages'&&method==='POST'){const kind=Object.entries(sources).find(([,v])=>body.parent.data_source_id===v)[0];const p=make(kind,body.properties,body.children??[]);if(failCreate===kind){failCreate='';throw Error('Lost create response');}return structuredClone(p);}
  const match=path.match(/^\/pages\/([^/]+)$/);if(match){const p=pages.get(match[1]);if(method==='PATCH'){const kind=Object.entries(sources).find(([,v])=>p.parent.data_source_id===v)[0];for(const [k,v]of Object.entries(body.properties))p.properties[k]={...v,type:schemas[kind].properties[k]?.type};}return structuredClone(p);}
  const block=path.match(/^\/blocks\/([^/]+)\/children/);if(block){if(method==='PATCH')blocks.get(block[1]).push(...body.children);return {results:structuredClone(blocks.get(block[1])),has_more:false};}
  throw Error('Unexpected '+path);
 };
 let last;
 const checkpoint=async(targets,status)=>{last={targets:structuredClone(targets),status};return true;};
 return {entry,student,intake,pages,blocks,calls,schemas,request,checkpoint,failCreate:kind=>{failCreate=kind;},saved:()=>last};
}
test('一度の保存から4先へ反映し、既定文・別々の日付・本文を再取得して照合',async()=>{
 const f=fixture();const result=await runEnrollmentEntry(f);assert.equal(result.status,'complete');
 assert.equal(f.pages.get(f.student.id).properties['本当の入塾日'].date.start,'2026-10-20');assert.equal(f.pages.get(f.student.id).properties['入塾手続日'].date.start,'2026-10-17');
 const mtg=f.pages.get(f.entry.targets.mtg.pageId);assert.equal(mtg.properties['内容'].title[1].text.content,' 詳細はこちら');assert.equal(mtg.properties['内容'].title.length,2);assert.equal(mtg.properties['内容'].title[0].mention.page.id,f.entry.targets.interview.pageId);
 const creates=f.calls.filter(c=>c.path==='/pages').length;await runEnrollmentEntry(f);assert.equal(f.calls.filter(c=>c.path==='/pages').length,creates);
});
test('作成成功後に応答が失われても原本を照合して再利用し二重登録しない',async()=>{
 const f=fixture();f.failCreate('interview');await runEnrollmentEntry(f);assert.equal(f.entry.targets.interview.status,'retry');assert.ok(f.entry.targets.interview.createAttempted);
 await runEnrollmentEntry(f);assert.equal(f.entry.targets.interview.status,'synced');assert.equal([...f.pages.values()].filter(p=>p.parent.data_source_id===sources.interview).length,1);
});
test('遠隔の変更・判断待ちを保持し、成功した反映先は巻き戻さない',async()=>{
 const f=fixture();f.student.properties['本当の入塾日'].date.start='2026-10-19';f.entry.payload.fields.classes={value:'候補のクラス',state:'review',reason:'クラスが不明'};
 const result=await runEnrollmentEntry(f);assert.equal(result.status,'review');assert.equal(f.entry.targets.student.status,'review');assert.equal(f.entry.targets.interview.status,'synced');assert.equal(f.entry.targets.mtg.status,'synced');assert.equal(f.student.properties['本当の入塾日'].date.start,'2026-10-19');
});
test('職員対応や受付が曖昧なときに勝手な新規作成をしない',async()=>{
 const f=fixture();f.entry.payload.actorIssue='職員の候補が複数あります';f.entry.targets.intake.pageId=null;await runEnrollmentEntry(f);assert.equal(f.entry.targets.interview.status,'review');assert.equal(f.entry.targets.intake.status,'review');assert.equal(f.calls.filter(c=>c.path==='/pages').length,0);
});
test('生徒情報と面談がそろった場合だけNotion生徒情報のチェックを付ける',async()=>{
 const f=fixture();f.schemas.intake.properties['notion生徒情報']={id:'notion',type:'checkbox'};await runEnrollmentEntry(f);assert.equal(f.pages.get(f.intake.id).properties['notion生徒情報'].checkbox,true);
 const pending=fixture();pending.schemas.intake.properties['notion生徒情報']={id:'notion',type:'checkbox'};pending.entry.payload.fields.admissionDate={value:'',state:'unknown'};await runEnrollmentEntry(pending);assert.equal(pending.pages.get(pending.intake.id).properties['notion生徒情報'],undefined);
});
