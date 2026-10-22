import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ENROLLMENT_SOURCES as sources,digest} from '../src/lib/enrollment-core.mjs';
import {KUDO_NOTION_TEACHER_ID} from '../src/lib/teacher-schedule-notion.mjs';
import {blankVisitFields,validateVisitPayload,visitProperties,visitBaseline,visitPatch,visitComparable} from '../src/lib/visit-followup-core.mjs';
import {prepareVisit,runVisitNotion} from '../src/lib/visit-followup-notion.mjs';
import {readVisit,saveVisit} from '../src/lib/visit-followup-service.mjs';
import {processPostEntry} from '../src/lib/post-interview-service.mjs';
const staffSource='19ef0120-80a7-8042-869a-000b871e5773';
function fixture(){
 const optionNames=['３者対面','中１','本校','見学中','新規問合せ','１Ｂ英','１Ｂ数','見学打合せ'];
 const schema=definitions=>({properties:Object.fromEntries(Object.entries(definitions).map(([name,type])=>[name,{type,...(['select','multi_select'].includes(type)?{[type]:{options:optionNames.map(name=>({id:name,name}))}}:type==='relation'?{relation:{data_source_id:staffSource}}:{})}]))});
 const schemas={student:schema({'生徒氏名':'title','学籍番号':'number','状態':'select','学年':'formula','所属':'select','見学開始':'date','見学終了':'date','見学期間':'date'}),intake:schema({'問合せ内容':'title','生徒情報DB':'relation','状態（問合DBのみの）':'select','見学開始日':'date','見学終了日':'date','見学打合せ日':'date','見学クラス':'multi_select','見打ち担当者':'relation','見学打合せ時の備考':'rich_text','見学用教材配布':'checkbox','公式LINE登録':'checkbox','Zoom設定':'checkbox','notion生徒情報':'checkbox'}),interview:schema({'生徒情報DB':'relation','面談内容':'title','面談日':'date','方法':'select','面談時の学年':'select','面談目的':'multi_select','記入者':'relation'}),mtg:schema({'生徒名':'relation','内容':'title','見出し':'rich_text','日付':'date','面談日':'date','方法':'select','面談時の学年':'select','面談目的':'multi_select','校舎':'multi_select','報告者':'relation'})};
 const pages=new Map(),children=new Map(),calls=[];let lost='',hide=false;
 const make=(kind,properties={},content=[])=>{const id=randomUUID(),page={id,parent:{data_source_id:sources[kind]},url:'https://example.invalid/'+id,properties:Object.fromEntries(Object.entries(properties).map(([name,p])=>[name,{type:schemas[kind].properties[name]?.type,...p}]))};pages.set(id,page);children.set(id,content);return page;};
 const student=make('student',{'生徒氏名':{title:[{type:'text',text:{content:'見本の見学生'}}]},'学籍番号':{number:2026999},'状態':{select:{id:'新規問合せ',name:'新規問合せ'}},'学年':{formula:{string:'中１'}},'所属':{select:{id:'本校',name:'本校'}}});
 const intake=make('intake',{'生徒情報DB':{relation:[{id:student.id}]},'状態（問合DBのみの）':{select:{id:'新規問合せ',name:'新規問合せ'}},'見学打合せ時の備考':{rich_text:[{type:'text',text:{content:'前からある備考',link:{url:'https://example.invalid/original'}}}]},'見学打合せ日':{date:{start:'2026-10-22T15:00:00+09:00',end:'2026-10-22T16:00:00+09:00'}}});
 const fields=blankVisitFields();for(const f of Object.values(fields))f.state='not_applicable';
 for(const [key,value]of Object.entries({date:'2026-10-22',title:'見学の打合せ',method:'３者対面',grade:'中１',campus:'本校',visitStart:'2026-10-26',visitEnd:'2026-11-06',classes:'１Ｂ英、１Ｂ数',visitStaff:KUDO_NOTION_TEACHER_ID,studentStatus:'見学中',intakeStatus:'見学中',reportTitle:'見学開始の報告',materials:'済'}))fields[key]={value,state:'confirmed'};
 const entry={id:randomUUID(),student_page_id:student.id,answer_page_id:student.id,version:1,payload:{workflow:'visit-followup',studentPageId:student.id,answerId:student.id,intakePageId:intake.id,recordSelection:'new',fields,record:'本人と保護者と見学について相談した。',intakeNote:'英数の２科目を見学予定。',workLog:{enabled:false},actorPageId:KUDO_NOTION_TEACHER_ID,intent:'reflect'},targets:{record:{status:'pending',pageId:null,baseline:{}},student:{status:'pending',pageId:student.id,baseline:visitBaseline(student)},intake:{status:'pending',pageId:intake.id,baseline:visitBaseline(intake)},mtg:{status:'pending',pageId:null,baseline:{}},survey:{status:'skipped'},workLog:{status:'skipped'},lines:{}}};
 const request=async(path,init={})=>{
  const method=init.method??'GET',body=init.body?JSON.parse(init.body):null;calls.push({path,method,body});
  const source=Object.keys(sources).find(k=>path===`/data_sources/${sources[k]}`);if(source)return structuredClone(schemas[source]);
  if(path===`/data_sources/${staffSource}/query`)return {results:[{id:KUDO_NOTION_TEACHER_ID,properties:{名前:{type:'title',title:[{text:{content:'工藤'}}]}}}],has_more:false};
  const query=Object.keys(sources).find(k=>path===`/data_sources/${sources[k]}/query`);if(query)return {results:hide&&query==='interview'?[]:[...pages.values()].filter(p=>p.parent.data_source_id===sources[query]),has_more:false};
  if(path==='/pages'&&method==='POST'){const kind=Object.keys(sources).find(k=>sources[k]===body.parent.data_source_id),page=make(kind,body.properties,body.children);if(lost===kind){lost='';throw Error('Lost create response');}return structuredClone(page);}
  const pageMatch=path.match(/^\/pages\/([^/]+)$/);if(pageMatch){const p=pages.get(pageMatch[1]);assert.ok(p);if(method==='PATCH')for(const [name,value]of Object.entries(body.properties))p.properties[name]={...value,type:p.properties[name]?.type};return structuredClone(p);}
  const block=path.match(/^\/blocks\/([^/]+)\/children/);if(block){if(method==='PATCH')children.get(block[1]).push(...body.children);return {results:structuredClone(children.get(block[1])),has_more:false};}
  throw Error('Unexpected request '+path);
 };
 const checkpoint=async()=>true,staff={staffId:randomUUID(),staffCode:'KUDO',role:'admin',displayName:'工藤'};
 return {schemas,pages,children,calls,student,intake,entry,request,checkpoint,staff,make,lose:kind=>{lost=kind;},hide:()=>{hide=true;}};
}
test('確認状態と原本の選択肢を検証し、未確認の作業を完了にしない',async()=>{
 const f=fixture(),p=await prepareVisit({request:f.request,studentPageId:f.student.id,staff:f.staff});
 assert.equal(p.payload.fields.studentStatus.state,'review');assert.equal(p.payload.fields.materials.state,'unknown');
 f.student.properties['学年'].formula.string='中1';const half=await prepareVisit({request:f.request,studentPageId:f.student.id,staff:f.staff});assert.equal(half.payload.fields.grade.value,'中１');assert.equal(half.payload.fields.grade.state,'review');
 const clean=validateVisitPayload(f.entry.payload,p.options);clean.fields.intakeStatus.state='review';assert.ok(!('状態（問合DBのみの）'in visitProperties(clean,'intake',f.schemas.intake,f.staff.staffId)));
 f.entry.payload.fields.visitEnd.value='2026-10-25';assert.throws(()=>validateVisitPayload(f.entry.payload,p.options),/終了日/);f.entry.payload.fields.visitEnd.value='2026-11-06';f.entry.payload.fields.classes.value='存在しないクラス';assert.throws(()=>validateVisitPayload(f.entry.payload,p.options),/原本の選択肢/);
});
test('４先へ別々の状態・期間・クラス・MTG参照を反映し、既存備考と予定時刻を保持する',async()=>{
 const f=fixture();await runVisitNotion(f);assert.ok(['record','student','intake','mtg'].every(k=>f.entry.targets[k].status==='synced'));
 assert.equal(f.student.properties['状態'].select.id,'見学中');assert.equal(f.intake.properties['状態（問合DBのみの）'].select.id,'見学中');assert.equal(f.student.properties['見学期間'].date.end,'2026-11-06');assert.equal(f.intake.properties['見学打合せ日'].date.start,'2026-10-22T15:00:00+09:00');
 assert.equal(f.intake.properties['見学用教材配布'].checkbox,true);assert.equal(f.intake.properties['公式LINE登録'],undefined);assert.equal(f.intake.properties['見学打合せ時の備考'].rich_text[0].text.link.url,'https://example.invalid/original');
 const mtg=f.pages.get(f.entry.targets.mtg.pageId);assert.equal(mtg.properties['内容'].title[0].mention.page.id,f.entry.targets.record.pageId);assert.equal(mtg.properties['内容'].title[1].text.content,' 詳細はこちら');const writes=f.calls.filter(c=>['PATCH'].includes(c.method)||c.path==='/pages').length;await runVisitNotion(f);assert.equal(f.calls.filter(c=>['PATCH'].includes(c.method)||c.path==='/pages').length,writes);
});
test('作成応答喪失は来歴リンクで照合し、同日別面談を誤採用せず二重登録しない',async()=>{
 const f=fixture();f.make('interview',{'生徒情報DB':{relation:[{id:f.student.id}]}},[]);f.lose('interview');await runVisitNotion(f);assert.equal(f.entry.targets.record.status,'retry');await runVisitNotion(f);assert.equal(f.entry.targets.record.status,'synced');assert.equal(f.calls.filter(c=>c.path==='/pages'&&c.body.parent.data_source_id===sources.interview).length,1);
 const unknown=fixture();unknown.lose('interview');await runVisitNotion(unknown);unknown.hide();await runVisitNotion(unknown);assert.equal(unknown.entry.targets.record.status,'review');assert.equal(unknown.calls.filter(c=>c.path==='/pages'&&c.body.parent.data_source_id===sources.interview).length,1);
});
test('既存面談の段落・添付を保持して追記し、共有生徒の面談は拒否する',async()=>{
 const f=fixture(),original={object:'block',type:'file',file:{name:'元の資料',external:{url:'https://example.invalid/file'}}},old=f.make('interview',{'生徒情報DB':{relation:[{id:f.student.id}]}},[original]);f.entry.targets.record={pageId:old.id,status:'pending',baseline:visitBaseline(old)};await runVisitNotion(f);assert.equal(f.entry.targets.record.status,'synced');assert.deepEqual(f.children.get(old.id)[0],original);const n=f.children.get(old.id).length;await runVisitNotion(f);assert.equal(f.children.get(old.id).length,n);
 const bad=fixture(),shared=bad.make('interview',{'生徒情報DB':{relation:[{id:bad.student.id},{id:randomUUID()}]}});bad.entry.targets.record={pageId:shared.id,status:'pending',baseline:visitBaseline(shared)};await runVisitNotion(bad);assert.equal(bad.entry.targets.record.status,'review');assert.equal(bad.entry.targets.mtg.status,'review');
});
test('原本の期間終了日の変更を検出し、成功した別の反映先を維持する',async()=>{
 const f=fixture();f.student.properties['見学期間']={date:{start:'2026-10-26',end:'2026-10-30'}};await runVisitNotion(f);assert.equal(f.entry.targets.student.status,'review');assert.equal(f.student.properties['見学期間'].date.end,'2026-10-30');assert.equal(f.entry.targets.record.status,'synced');assert.equal(f.entry.targets.intake.status,'synced');
 assert.throws(()=>visitPatch({properties:{期間:{date:{start:'2026-10-01',end:'2026-10-03'}}}},{期間:{date:{start:'2026-10-01',end:'2026-10-10'}}},{期間:{date:{start:'2026-10-01',end:'2026-10-02',time_zone:null}}}),/更新/);
});
test('複数の受付・選択解除と別用途の案件を区別し、対象を自動復活させない',async()=>{
 const f=fixture();f.make('intake',{'生徒情報DB':{relation:[{id:f.student.id}]}});const p=await prepareVisit({request:f.request,studentPageId:f.student.id,staff:f.staff,prior:f.entry,intakePageId:''});assert.equal(p.targets.intake.pageId,null);
 const db={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{payload:{workflow:'parent-contact'}}})})};await assert.rejects(readVisit(db,randomUUID()),/選び直し/);
 f.entry.targets.intake.pageId=null;await runVisitNotion(f);assert.equal(f.entry.targets.intake.status,'review');
});
test('同じ保存操作は外部の再読取より先に復元し、版・原本競合では書かない',async()=>{
 const f=fixture(),body={id:f.entry.id,operationKey:randomUUID(),version:0,intent:'reflect',payload:f.entry.payload,snapshot:'stale'},context={staff:f.staff,identity:{authUserId:randomUUID(),authSessionId:randomUUID()}};let rpcCalls=0,event=null,row=f.entry;
 const db={from:table=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='post_interview_entry_events'?event:row})}),rpc:async()=>{rpcCalls++;return {data:true};}};
 await assert.rejects(saveVisit({db,request:f.request,body,context}),/原本が更新/);assert.equal(rpcCalls,0);
 event={entry_id:body.id,actor_id:context.staff.staffId,request_hash:digest(body)};
 const got=await saveVisit({db,request:async()=>assert.fail('Remote read on replay'),body,context});assert.equal(got,row);assert.equal(rpcCalls,0);
});
test('共通ワーカーは見学専用の４先の結果を集計し、アンケート・LINEには書かない',async()=>{
 const f=fixture();f.entry.targets.intake.pageId=null;const checkpoints=[];const db={rpc:async(name,p)=>name==='post_interview_entry_claim'?{data:f.entry}:(checkpoints.push(structuredClone(p)),{data:true})};
 const result=await processPostEntry({db,request:f.request,recipients:async()=>assert.fail('No LINE'),fetcher:async()=>assert.fail('No LINE')});assert.equal(result.status,'review');assert.equal(checkpoints.at(-1).p_targets.intake.status,'review');assert.equal(f.calls.some(c=>c.path.includes('survey')),false);
});
test('Notionが補完する書式・日付のnullを同値として照合する',()=>{
 const desired={rich_text:[{type:'text',text:{content:'見学開始の報告'}}]},actual={type:'rich_text',rich_text:[{type:'text',text:{content:'見学開始の報告',link:null},plain_text:'見学開始の報告',annotations:{bold:false,italic:false,strikethrough:false,underline:false,code:false,color:'default'}}]};
 assert.deepEqual(visitComparable(desired),visitComparable(actual));assert.deepEqual(visitComparable({date:{start:'2026-10-22'}}),visitComparable({date:{start:'2026-10-22',end:null,time_zone:null}}));
});
test('新しい見学案件を既存RPCへ保存し、対象・監査・下書きと選択解除を保持する',async()=>{
 const f=fixture(),p=await prepareVisit({request:f.request,studentPageId:f.student.id,staff:f.staff,recordSelection:'new'});let row=null,saved;
 const db={from:table=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='post_interview_entry_events'?null:row})}),rpc:async(_name,args)=>{saved=args;row={id:f.entry.id,version:1,student_page_id:f.student.id,payload:args.p_payload,targets:args.p_targets};return {data:true};}};
 const context={staff:f.staff,identity:{authUserId:randomUUID(),authSessionId:randomUUID()}},body={id:f.entry.id,operationKey:randomUUID(),version:0,intent:'reflect',snapshot:p.snapshot,payload:f.entry.payload};
 const result=await saveVisit({db,request:f.request,body,context});assert.equal(result.payload.workflow,'visit-followup');assert.equal(saved.p_payload.answerId,f.student.id);assert.equal(saved.p_payload.actorPageId,KUDO_NOTION_TEACHER_ID);assert.equal(saved.p_payload.fields.date.confirmedBy,f.staff.staffId);assert.deepEqual(saved.p_targets.lines,{});assert.equal(saved.p_targets.survey.status,'skipped');
 body.intent='draft';body.version=1;body.operationKey=randomUUID();body.payload={...f.entry.payload,intakePageId:''};await saveVisit({db,request:f.request,body,context});assert.equal(saved.p_targets.intake.pageId,null);assert.equal(saved.p_payload.intakePageId,'');assert.ok(['record','student','intake','mtg'].every(k=>saved.p_targets[k].status==='skipped'));
});
