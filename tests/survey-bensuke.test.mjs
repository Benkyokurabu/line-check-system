import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSurveySchedule,surveyScheduleValue,sameSurveySchedule} from '../src/lib/survey-bensuke.mjs';
import {BENSUKE_SOURCE} from '../src/lib/bensuke-booking.mjs';
const answerId='11111111-1111-4111-8111-111111111111',teacherId='22222222-2222-4222-8222-222222222222',pageId='33333333-3333-4333-8333-333333333333';
function fixture(){
 const answer={id:answerId,last_edited_time:'v1',properties:{'面談日':{date:null}}};
 const link={state:'new',lease:'lease'},calls=[];let page,failCreate=false,failSurvey=false,failUpdate=false;
 const request=async(path,init={})=>{
  calls.push([path,init]);
  const body=init.body?JSON.parse(init.body):null;
  if(path===`/pages/${answerId}`){if(init.method==='PATCH'){if(failSurvey)throw Error('offline');answer.properties['面談日']=body.properties['面談日'];answer.last_edited_time='v2';}return structuredClone(answer);}
  if(path===`/data_sources/${BENSUKE_SOURCE}`)return {properties:{'担当者':{type:'relation',relation:{data_source_id:'staff'}},'名前':{type:'title'},'日時':{type:'date'},'校舎':{type:'multi_select'},'教室':{type:'select'},'備考':{type:'rich_text'},'内容':{type:'multi_select',multi_select:{options:['面談予定','面談(オンライン)','面談(対面)','電話'].map(name=>({name}))}}}};
  if(path==='/data_sources/staff/query')return {results:[{id:teacherId,properties:{name:{type:'title',title:[{plain_text:'工藤先生'}]}}}]};
  if(path.endsWith('/query'))return {results:page?[page]:[]};
  if(path==='/pages'){page={id:pageId,parent:{data_source_id:BENSUKE_SOURCE},properties:body.properties};if(failCreate)throw Error('lost response');return page;}
  if(path===`/pages/${pageId}`){if(init.method==='PATCH'){Object.assign(page.properties,body.properties);if(failUpdate)throw Error('lost update');}return structuredClone(page);}
  throw Error(path);
 };
 const jsonb=v=>Array.isArray(v)?v.map(jsonb):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,jsonb(v[k])])):v;
 const args={request,answer,student:{student_name:'架空 生徒',grade:'中2',homeroom_teacher:'工藤'},date:'2026-10-03',time:'18:00',expectedEditedAt:'v1',claim:async()=>({...link}),store:async(_id,_lease,v)=>Object.assign(link,jsonb(v))};
 return {args,answer,link,calls,get page(){return page;},failCreate:()=>{failCreate=true;},failSurvey:()=>{failSurvey=true;},failUpdate:()=>{failUpdate=true;},recover:()=>{failCreate=failSurvey=failUpdate=false;}};
}
test('date save creates a Bensuke schedule with the homeroom teacher and also saves the survey',async()=>{
 const f=fixture();assert.equal((await saveSurveySchedule(f.args)).ok,true);
 assert.equal(f.link.state,'synced');assert.equal(f.answer.properties['面談日'].date.start,'2026-10-03T18:00:00+09:00');
 assert.deepEqual(surveyScheduleValue(f.page).teachers,[teacherId]);assert.deepEqual(surveyScheduleValue(f.page).tags,['面談(オンライン)']);
 assert.equal(surveyScheduleValue(f.page).title,'中２架空生徒／三者面談');
 assert.ok(!JSON.stringify(f.page).includes('相談メモ'));assert.ok(!f.page.properties['校舎']);
});
test('schedule comparisons survive PostgreSQL JSONB key reordering and UTC conversion',()=>{
 const a={title:'面談',start:'2026-10-03T18:00:00+09:00',end:null,teachers:[],tags:['面談予定'],note:'note'};
 const b={end:null,note:'note',start:'2026-10-03T09:00:00Z',tags:['面談予定'],teachers:[],title:'面談'};
 assert.equal(sameSurveySchedule(a,b),true);
});
test('native Bensuke style stores the selected method, end and registered campus',async()=>{
 const f=fixture();f.args.student.campus='南教室';f.args.endTime='18:45';f.args.method='２者対面';await saveSurveySchedule(f.args);
 const v=surveyScheduleValue(f.page);assert.equal(v.title,'中２架空生徒／二者面談');assert.equal(v.end,'2026-10-03T18:45:00+09:00');assert.deepEqual(v.tags,['面談(対面)']);assert.deepEqual(v.campuses,['南教室']);
 await assert.rejects(()=>saveSurveySchedule({...f.args,endTime:'17:00'}),/終了時刻/);
});
test('date-only saves remain supported and a same-date retry does not create another page',async()=>{
 const f=fixture();f.args.time='';await saveSurveySchedule(f.args);await saveSurveySchedule(f.args);
 assert.equal(f.answer.properties['面談日'].date.start,'2026-10-03');assert.equal(f.calls.filter(([p])=>p==='/pages').length,1);
});
test('a student without a homeroom teacher still gets a schedule without a guessed assignee',async()=>{
 const f=fixture();f.args.student.homeroom_teacher='未設定';await saveSurveySchedule(f.args);assert.deepEqual(surveyScheduleValue(f.page).teachers,[]);
});
test('rescheduling updates the linked page and preserves its unrelated properties',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);f.page.properties['校舎']={multi_select:[{name:'本校'}]};f.args.date='2026-10-04';f.args.expectedEditedAt='v2';
 await saveSurveySchedule(f.args);assert.equal(f.link.page_id,pageId);assert.equal(f.calls.filter(([p])=>p==='/pages').length,1);assert.equal(f.page.properties['校舎'].multi_select[0].name,'本校');
});
test('a lost creation response is recovered by its answer marker without another POST',async()=>{
 const f=fixture();f.failCreate();await assert.rejects(()=>saveSurveySchedule(f.args),/完了できません/);assert.equal(f.link.state,'creating');
 f.recover();await saveSurveySchedule(f.args);assert.equal(f.calls.filter(([p])=>p==='/pages').length,1);
});
test('an unresolved creation is not retried when its marker is not found',async()=>{
 const f=fixture();f.link.state='creating';await assert.rejects(()=>saveSurveySchedule(f.args),/再作成を停止/);assert.equal(f.calls.filter(([p])=>p==='/pages').length,0);
});
test('survey write failure leaves a recoverable Bensuke link',async()=>{
 const f=fixture();f.failSurvey();await assert.rejects(()=>saveSurveySchedule(f.args));assert.equal(f.link.page_id,pageId);assert.equal(f.link.state,'saved');
 f.recover();await saveSurveySchedule(f.args);assert.equal(f.link.state,'synced');assert.equal(f.calls.filter(([p])=>p==='/pages').length,1);
});
test('lost update responses are recovered without duplicate creation',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);f.args.date='2026-10-04';f.args.expectedEditedAt='v2';f.failUpdate();await assert.rejects(()=>saveSurveySchedule(f.args));
 f.recover();await saveSurveySchedule(f.args);assert.equal(f.link.state,'synced');assert.equal(f.calls.filter(([p])=>p==='/pages').length,1);
});
test('direct Notion edits and deletion stop the write',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);f.page.properties['名前']={title:[{text:{content:'直接編集'}}]};f.args.date='2026-10-04';f.args.expectedEditedAt='v2';
 await assert.rejects(()=>saveSurveySchedule(f.args),/変更されています/);assert.equal(f.page.properties['名前'].title[0].text.content,'直接編集');
 f.page.archived=true;await assert.rejects(()=>saveSurveySchedule(f.args),/削除/);
});
test('invalid dates and stale survey versions make no external writes',async()=>{
 const f=fixture();await assert.rejects(()=>saveSurveySchedule({...f.args,date:'2026-02-30'}));
 f.answer.last_edited_time='other';await assert.rejects(()=>saveSurveySchedule(f.args),/更新されています/);assert.equal(f.calls.filter(([,i])=>i.method==='PATCH').length,0);assert.equal(f.calls.filter(([p])=>p==='/pages').length,0);
});
