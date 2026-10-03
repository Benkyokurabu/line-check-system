import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSurveySchedule,surveyScheduleValue,sameSurveySchedule,activeSurveySchedule} from '../src/lib/survey-bensuke.mjs';
import {BENSUKE_SOURCE} from '../src/lib/bensuke-booking.mjs';
const answerId='11111111-1111-4111-8111-111111111111',teacherId='22222222-2222-4222-8222-222222222222',pageId='33333333-3333-4333-8333-333333333333';
function fixture(){
 const answer={id:answerId,last_edited_time:'v1',properties:{'面談日':{date:null}}};
 const link={state:'new',lease:'lease'},calls=[],slots=[],createdPages=[];let page,failCreate=false,failSurvey=false,failUpdate=false,failArchive=false;
 const request=async(path,init={})=>{
  calls.push([path,init]);
  const body=init.body?JSON.parse(init.body):null;
  if(path===`/pages/${answerId}`){if(init.method==='PATCH'){if(failSurvey)throw Error('offline');answer.properties['面談日']=body.properties['面談日'];answer.last_edited_time='v2';}return structuredClone(answer);}
  if(path===`/data_sources/${BENSUKE_SOURCE}`)return {properties:{'担当者':{type:'relation',relation:{data_source_id:'staff'}},'名前':{type:'title'},'日時':{type:'date'},'校舎':{type:'multi_select'},'教室':{type:'select'},'備考':{type:'rich_text'},'内容':{type:'multi_select',multi_select:{options:['面談予定','面談(オンライン)','面談(対面)','電話'].map(name=>({name}))}}}};
  if(path==='/data_sources/staff/query')return {results:[{id:teacherId,properties:{name:{type:'title',title:[{plain_text:'工藤先生'}]}}}]};
  if(path.endsWith('/query'))return {results:body.filter.property==='備考'?(page?[page]:[]):slots.filter(p=>!p.archived)};
  if(path==='/pages'){page={id:createdPages.length?'66666666-6666-4666-8666-666666666666':pageId,parent:{data_source_id:BENSUKE_SOURCE},properties:body.properties};createdPages.push(page);if(failCreate)throw Error('lost response');return page;}
  const created=createdPages.find(p=>path===`/pages/${p.id}`);
  if(created){if(init.method==='PATCH'){Object.assign(created.properties,body.properties);if(failUpdate)throw Error('lost update');}return structuredClone(created);}
  const slot=slots.find(p=>path===`/pages/${p.id}`);
  if(slot){if(init.method==='PATCH'){Object.assign(slot.properties,body.properties);if(body.archived)slot.archived=true;if(failArchive||failUpdate)throw Error('lost response');}return structuredClone(slot);}
  throw Error(path);
 };
 const jsonb=v=>Array.isArray(v)?v.map(jsonb):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,jsonb(v[k])])):v;
 const args={request,answer,student:{student_name:'架空 生徒',grade:'中2',homeroom_teacher:'工藤'},date:'2026-10-03',time:'18:00',expectedEditedAt:'v1',claim:async()=>({...link}),store:async(_id,_lease,v)=>Object.assign(link,jsonb(v)),reserve:async(...values)=>calls.push(['reserve',values])};
 return {args,answer,link,calls,slots,get page(){return slots.find(s=>s.id===link.page_id)??page;},failCreate:()=>{failCreate=true;},failSurvey:()=>{failSurvey=true;},failUpdate:()=>{failUpdate=true;},failArchive:()=>{failArchive=true;},recover:()=>{failCreate=failSurvey=failUpdate=failArchive=false;}};
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
test('direct edits to an active Notion appointment stop the write',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);f.page.properties['名前']={title:[{text:{content:'直接編集'}}]};f.args.date='2026-10-04';f.args.expectedEditedAt='v2';
 await assert.rejects(()=>saveSurveySchedule(f.args),/変更されています/);assert.equal(f.page.properties['名前'].title[0].text.content,'直接編集');
});
test('invalid dates and stale survey versions make no external writes',async()=>{
 const f=fixture();await assert.rejects(()=>saveSurveySchedule({...f.args,date:'2026-02-30'}));
 f.answer.last_edited_time='other';await assert.rejects(()=>saveSurveySchedule(f.args),/更新されています/);assert.equal(f.calls.filter(([,i])=>i.method==='PATCH').length,0);assert.equal(f.calls.filter(([p])=>p==='/pages').length,0);
});

function addSlot(f,changes={}){
 const p={id:'44444444-4444-4444-8444-444444444444',parent:{data_source_id:BENSUKE_SOURCE},last_edited_time:'slot-v1',properties:{
  '名前':{title:[{text:{content:'本：工藤予約可'}}]},'日時':{date:{start:'2026-10-03T09:00:00Z',end:'2026-10-03T09:45:00Z'}},
  '担当者':{relation:[{id:teacherId}]},'校舎':{multi_select:[{name:'本校'}]},'教室':{select:{name:'本②'}},'内容':{multi_select:[{name:'本：予約可'}]},'備考':{rich_text:[{text:{content:'既存のメモ'}}]},
 },...changes};f.slots.push(p);return p;
}
test('a matching availability becomes the appointment without creating another card',async()=>{
 const f=fixture(),slot=addSlot(f);f.args.student.campus='南教室';
 const result=await saveSurveySchedule(f.args);assert.equal(result.bensuke.id,slot.id);assert.equal(result.bensuke.endTime,'18:45');
 assert.equal(f.calls.filter(([p])=>p==='/pages').length,0);assert.equal(f.link.state,'synced');
 assert.deepEqual(surveyScheduleValue(slot).tags,['面談(オンライン)']);assert.deepEqual(surveyScheduleValue(slot).campuses,['本校']);
 assert.equal(slot.properties['教室'].select.name,'本②');assert.match(surveyScheduleValue(slot).note,/既存のメモ\n勉たん面談アンケート:/);
 const patch=f.calls.find(([p,i])=>p===`/pages/${slot.id}`&&i.method==='PATCH');assert.ok(!JSON.parse(patch[1].body).properties['校舎']);assert.ok(!JSON.parse(patch[1].body).properties['教室']);
 await saveSurveySchedule(f.args);assert.equal(surveyScheduleValue(slot).end,'2026-10-03T09:45:00Z');assert.equal(surveyScheduleValue(slot).note.split('勉たん面談アンケート:').length,2);
});
test('an already linked appointment keeps its URL and removes the matching availability',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);const slot=addSlot(f);await saveSurveySchedule(f.args);
 assert.equal(f.link.page_id,pageId);assert.equal(slot.archived,true);assert.equal(f.page.properties['日時'].date.end,'2026-10-03T09:45:00Z');
 assert.equal(f.calls.filter(([p])=>p==='/pages').length,1);assert.equal(f.link.state,'synced');
});
test('a lost reuse response recovers the same card and its original end',async()=>{
 const f=fixture(),slot=addSlot(f);f.failUpdate();await assert.rejects(()=>saveSurveySchedule(f.args));assert.equal(f.link.page_id,slot.id);
 f.recover();await saveSurveySchedule(f.args);assert.equal(f.link.state,'synced');assert.equal(f.calls.filter(([p])=>p==='/pages').length,0);assert.ok(surveyScheduleValue(slot).end);
});
test('a lost archive response retries without creating or archiving another card',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);const slot=addSlot(f);f.failArchive();await assert.rejects(()=>saveSurveySchedule(f.args));assert.equal(slot.archived,true);
 f.recover();await saveSurveySchedule(f.args);assert.equal(f.link.state,'synced');assert.equal(f.calls.filter(([p,i])=>p===`/pages/${slot.id}`&&i.method==='PATCH').length,1);
});
test('rescheduling consumes the new availability and preserves the linked appointment',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);const slot=addSlot(f);slot.properties['日時'].date={start:'2026-10-04T18:00:00+09:00',end:'2026-10-04T18:45:00+09:00'};
 f.args.date='2026-10-04';f.args.expectedEditedAt='v2';await saveSurveySchedule(f.args);assert.equal(f.link.page_id,pageId);assert.equal(slot.archived,true);
});
test('ambiguous, mixed-purpose, overlong and reserved availability cannot be consumed',async()=>{
 for(const mode of ['ambiguous','mixed','long','reserved']){
  const f=fixture(),slot=addSlot(f);
  if(mode==='ambiguous'){const other=addSlot(f,{id:'55555555-5555-4555-8555-555555555555'});other.properties['校舎']={multi_select:[{name:'南教室'}]};other.properties['内容']={multi_select:[{name:'南：予約可'}]};}
  if(mode==='mixed')slot.properties['内容'].multi_select.push({name:'診断テスト'});
  if(mode==='long')f.args.endTime='19:00';
  if(mode==='reserved')f.args.reserve=async()=>{throw Error('another booking');};
  await assert.rejects(()=>saveSurveySchedule(f.args));assert.equal(f.calls.filter(([p,i])=>p==='/pages'||i?.method==='PATCH').length,0);assert.ok(!slot.archived);
 }
});
test('identical duplicate availability is consumed once and the extra card is archived',async()=>{
 const f=fixture(),a=addSlot(f),b=addSlot(f,{id:'55555555-5555-4555-8555-555555555555'});
 await saveSurveySchedule(f.args);assert.equal(f.link.page_id,a.id);assert.ok(!a.archived);assert.equal(b.archived,true);assert.equal(f.calls.filter(([p])=>p==='/pages').length,0);
});
test('schedule-based campus resolves two campus candidates and leaves the other campus intact',async()=>{
 const f=fixture(),a=addSlot(f),b=addSlot(f,{id:'55555555-5555-4555-8555-555555555555'});
 b.properties['校舎']={multi_select:[{name:'南教室'}]};b.properties['内容']={multi_select:[{name:'南：予約可'}]};b.properties['教室']={select:{name:'南②'}};
 f.args.resolveCampus=async()=> '南教室';await saveSurveySchedule(f.args);assert.equal(f.link.page_id,b.id);assert.deepEqual(surveyScheduleValue(a).tags,['本：予約可']);assert.deepEqual(surveyScheduleValue(b).campuses,['南教室']);
});
test('without availability, a new appointment uses the teacher schedule campus',async()=>{
 const f=fixture();f.args.student.campus='本校';f.args.resolveCampus=async()=> '南教室';await saveSurveySchedule(f.args);assert.deepEqual(surveyScheduleValue(f.page).campuses,['南教室']);
});
test('retry keeps the consumed slot campus without needing another schedule decision',async()=>{
 const f=fixture();addSlot(f);f.args.resolveCampus=async()=>{throw Error('ambiguous day');};await saveSurveySchedule(f.args);await saveSurveySchedule(f.args);assert.equal(f.link.state,'synced');assert.deepEqual(surveyScheduleValue(f.page).campuses,['本校']);
});
test('cleanup corrects the linked appointment campus to the availability campus',async()=>{
 const f=fixture();f.args.student.campus='南教室';await saveSurveySchedule(f.args);addSlot(f);f.args.endTime='18:45';await saveSurveySchedule(f.args);assert.deepEqual(surveyScheduleValue(f.page).campuses,['本校']);
});
test('a direct availability edit during save stops the conversion',async()=>{
 const f=fixture(),slot=addSlot(f);f.args.reserve=async()=>{slot.last_edited_time='changed';slot.properties['教室'].select.name='本③';};
 await assert.rejects(()=>saveSurveySchedule(f.args),/更新されました/);assert.deepEqual(surveyScheduleValue(slot).tags,['本：予約可']);
});

test('a trashed linked appointment is ignored and the current availability is reused',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);const old=f.page;old.archived=old.in_trash=true;const slot=addSlot(f);
 await saveSurveySchedule(f.args);assert.equal(f.link.page_id,slot.id);assert.equal(f.link.state,'synced');assert.equal(old.archived,true);assert.equal(old.in_trash,true);
 assert.deepEqual(surveyScheduleValue(slot).tags,['面談(オンライン)']);assert.deepEqual(surveyScheduleValue(slot).campuses,['本校']);
 assert.equal(f.calls.filter(([p])=>p==='/pages').length,1);
 await saveSurveySchedule(f.args);assert.equal(f.link.page_id,slot.id);assert.equal(f.calls.filter(([p])=>p==='/pages').length,1);
});
test('without current availability, a trashed appointment permits a fresh new save',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);const old=f.page;old.in_trash=true;await saveSurveySchedule(f.args);
 assert.notEqual(f.link.page_id,old.id);assert.equal(old.in_trash,true);assert.equal(f.link.state,'synced');assert.equal(f.calls.filter(([p])=>p==='/pages').length,2);
});
test('a lost response after replacing a trashed link recovers the same availability',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);f.page.in_trash=true;const slot=addSlot(f);f.failUpdate();
 await assert.rejects(()=>saveSurveySchedule(f.args));assert.equal(f.link.page_id,slot.id);
 f.recover();await saveSurveySchedule(f.args);assert.equal(f.link.state,'synced');assert.equal(f.calls.filter(([p])=>p==='/pages').length,1);
});
test('display ignores trash and preserves source validation',async()=>{
 const f=fixture();await saveSurveySchedule(f.args);assert.equal((await activeSurveySchedule(f.args.request,pageId)).id,pageId);
 f.page.in_trash=true;assert.equal(await activeSurveySchedule(f.args.request,pageId),null);
 f.page.parent.data_source_id=answerId;await assert.rejects(()=>activeSurveySchedule(f.args.request,pageId),/別のDB/);
});
