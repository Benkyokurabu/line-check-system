import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BENSUKE_SOURCE,prepareBinding,prepareBindings,queryPages,teacherMatch,scheduleValue,scheduleProperties,desiredSchedule,equivalentSchedule,assertNoNotionConflicts,remoteAppointment} from '../src/lib/bensuke-booking.mjs';
import {syncBensukeBooking} from '../src/lib/bensuke-sync.mjs';
const pageId='11111111-1111-4111-8111-111111111111',teacherId='22222222-2222-4222-8222-222222222222';
const schema={properties:Object.fromEntries(Object.entries({名前:['title'],日時:['date'],担当者:['relation'],校舎:['multi_select','本校','南教室'],教室:['select','本①','本②','南①'],内容:['multi_select','本：予約可','南：予約可','面談(対面)','面談(オンライン)','電話']}).map(([name,[type,...names]])=>[name,{id:name,name,type,[type]:type==='relation'?{data_source_id:'staff'}:{options:names.map(n=>({id:n,name:n}))}}]))};
const original={title:'予約可',date:{start:'2026-12-01T13:00:00+09:00',end:'2026-12-01T13:45:00+09:00',time_zone:null},teachers:[teacherId],campuses:['本校'],room:'本①',tags:['本：予約可']};
const data={studentId:pageId,studentName:'架空の生徒',teacher:'工藤',date:'2026-12-01',start:'13:00',end:'13:45',busyStart:'13:00',busyEnd:'14:00',room:'1',campus:'本校',method:'対面',purpose:'相談',participants:'保護者',channel:'職員入力',note:'秘密の相談'};
const directory=[{id:teacherId,name:'工藤先生'}];
function card(value=original,id=pageId){
 const props=scheduleProperties(value,schema);
 return {id,parent:{data_source_id:BENSUKE_SOURCE},last_edited_time:'2026-09-16T00:00:00.000Z',properties:Object.fromEntries(Object.entries(props).map(([id,v])=>[id,{id,type:schema.properties[id].type,...v,...(v.select?{select:{id:v.select.id,name:v.select.id}}:{}),...(v.multi_select?{multi_select:v.multi_select.map(o=>({...o,name:o.id}))}:{})}]))};
}
function fixture(){
 let page=card();const patches=[],stages=[];
 const booking={id:'booking',status:'confirmed',data,notion_page_id:pageId,notion_original:original,notion_baseline:original,notion_expected:null};
 const request=async(path,init)=>{
  if(path===`/data_sources/${BENSUKE_SOURCE}`)return schema;
  if(path==='/data_sources/staff/query')return {results:[{id:teacherId,properties:{名前:{type:'title',title:[{plain_text:'工藤先生'}]}}}]};
  if(path.endsWith('/query'))return {results:[]};
  if(init?.method==='PATCH'){patches.push(JSON.parse(init.body));page=card(desiredSchedule(booking,teacherId));return page;}
  return page;
 };
 return {booking,request,patches,stages,setPage:p=>{page=p;},stage:async value=>{stages.push(value);booking.notion_expected=value;}};
}
test('職員名の敬称・異体字を対応し、同姓同名の重複は推測しない',()=>{
 assert.equal(teacherMatch('工藤',directory).id,teacherId);
 assert.equal(teacherMatch('髙山',[{id:'a',name:'高山先生'},{id:'b',name:'髙山先生'}]).id,'b');
 assert.throws(()=>teacherMatch('髙山',[{id:'a',name:'髙山先生'},{id:'b',name:'髙山先生'}]),/一意/);
});
test('履歴が20ページを超える先生も全件を読み、上限超過や巡回は拒否する',async()=>{
 const request=async(_path,init)=>{const page=Number(JSON.parse(init.body).start_cursor??0);return {results:[],has_more:page<29,next_cursor:String(page+1)};};
 assert.equal((await queryPages(request,'staff',undefined,50)).length,0);
 await assert.rejects(()=>queryPages(request,'staff'),/全予定/);
});
test('3希望で定義・職員・リソース履歴を共有し、別の申請では取り直す',async()=>{
 const f=fixture(),calls=[],pages=new Map();
 const choices=[1,2,3].map(n=>{
  const id=`11111111-1111-4111-8111-11111111111${n}`,day=`2026-12-0${n}`;
  pages.set(`/pages/${id}`,card({...original,date:{start:day+'T13:00:00+09:00',end:day+'T13:45:00+09:00'}},id));
  return {pageId:id,editedAt:card().last_edited_time,data:{...data,date:day}};
 });
 const request=async(path,init)=>{calls.push([path,init?.body]);return pages.get(path)??f.request(path,init);};
 const result=await prepareBindings({request,choices});assert.equal(result.length,3);assert.equal(calls.length,8);
 assert.equal(calls.filter(([path])=>path===`/data_sources/${BENSUKE_SOURCE}`).length,1);
 assert.equal(calls.filter(([path])=>path==='/data_sources/staff/query').length,1);
 for(const [path,body] of calls.filter(([path])=>path===`/data_sources/${BENSUKE_SOURCE}/query`)){
  assert.ok(path);assert.match(body,/2026-12-03T23:59:59/);assert.ok(!body.includes('on_or_after'));
 }
 await prepareBindings({request,choices});assert.equal(calls.length,16);
 pages.set(`/pages/${choices[1].pageId}`,{...pages.get(`/pages/${choices[1].pageId}`),last_edited_time:'changed'});
 await assert.rejects(()=>prepareBindings({request,choices}),/変更/);
});
test('まとめ取得でも後続ページの長期予定・別校舎の重複を見落とさない',async()=>{
 const f=fixture(),conflict=card({...original,date:{start:'2026-11-01T00:00:00+09:00',end:'2026-12-02T14:00:00+09:00'},campuses:['南教室'],room:'南①',tags:['面談(対面)']},'conflict');
 const request=async(path,init)=>{
  if(path===`/data_sources/${BENSUKE_SOURCE}/query`){const body=JSON.parse(init.body);return body.start_cursor?{results:[conflict]}:{results:[],has_more:true,next_cursor:'next'};}
  return f.request(path,init);
 };
 await assert.rejects(()=>prepareBindings({request,choices:[{pageId,editedAt:card().last_edited_time,data}]}),/重なり/);
});
test('予約可を再取得して日時・担当・所属DB・版を確認する',async()=>{
 const f=fixture(),args={request:f.request,pageId,editedAt:card().last_edited_time,data};
 const b=await prepareBinding(args);assert.equal(b.pageId,pageId);assert.equal(b.baseline.title,'予約可');
 await assert.rejects(()=>prepareBinding({...args,editedAt:'old'}),/変更/);
 await assert.rejects(()=>prepareBinding({...args,data:{...data,start:'14:00'}}),/変更せず/);
 f.setPage({...card(),parent:{data_source_id:'other'}});await assert.rejects(()=>prepareBinding(args),/別のDB/);
});
test('前日から続く予定と終了不明・校舎をまたぐ同じ担当の予定を重複検査する',()=>{
 const other=card({...original,title:'既存面談',date:{start:'2026-11-30T22:00:00+09:00',end:'2026-12-01T14:00:00+09:00'},campuses:['南教室'],room:'南①',tags:['面談(対面)']},'other');
 assert.throws(()=>assertNoNotionConflicts([other],{schema,data,teacherId,excludeId:pageId}),/重なり/);
 const allDay=card({...original,date:{start:'2026-12-01',end:null},tags:['面談(対面)']},'other');
 assert.throws(()=>assertNoNotionConflicts([allDay],{schema,data,teacherId,excludeId:pageId}),/重なり/);
 assert.doesNotThrow(()=>assertNoNotionConflicts([card(original,'availability')],{schema,data,teacherId,excludeId:pageId}));
 const oldZero=card({...original,date:{start:'2020-01-01T13:00:00+09:00',end:'2020-01-01T13:00:00+09:00'},tags:['電話']},'old');
 assert.doesNotThrow(()=>assertNoNotionConflicts([oldZero],{schema,data,teacherId,excludeId:pageId}));
});
test('承認で元カードだけを更新し、相談メモ・下書き・本文を送信しない',async()=>{
 const f=fixture();const result=await syncBensukeBooking({...f,sourceId:BENSUKE_SOURCE});
 assert.equal(result.status,'synced');assert.equal(f.patches.length,1);assert.equal(f.stages.length,1);
 assert.ok(!JSON.stringify(f.patches).includes('秘密'));assert.deepEqual(Object.keys(f.patches[0]),['properties']);
 assert.deepEqual(f.patches[0].properties.担当者,{relation:[{id:teacherId}]});
});
test('Notionの先行編集を上書きせず、削除にも再作成しない',async()=>{
 const f=fixture();f.setPage(card({...original,title:'直接変更'}));
 assert.equal((await syncBensukeBooking({...f,sourceId:BENSUKE_SOURCE})).status,'review');assert.equal(f.patches.length,0);
 f.setPage({...card(),in_trash:true});await assert.rejects(()=>syncBensukeBooking({...f,sourceId:BENSUKE_SOURCE}),/削除/);
});
test('PATCHの応答喪失後は永続化した反映内容と照合し、再書込みしない',async()=>{
 const f=fixture();const request=async(path,init)=>{const result=await f.request(path,init);if(init?.method==='PATCH')throw Error('lost response');return result;};
 assert.equal((await syncBensukeBooking({...f,request,sourceId:BENSUKE_SOURCE})).status,'uncertain');
 assert.equal((await syncBensukeBooking({...f,sourceId:BENSUKE_SOURCE})).status,'synced');assert.equal(f.patches.length,1);
});
test('書込み直前に変更された場合は停止し、未送信の記録を解除する',async()=>{
 const f=fixture(),stage=async v=>{await f.stage(v);if(v)f.setPage(card({...original,title:'競合'}));};
 assert.equal((await syncBensukeBooking({...f,stage,sourceId:BENSUKE_SOURCE})).status,'review');assert.equal(f.patches.length,0);assert.equal(f.stages.at(-1),null);
});
test('取消は元の予約可を復元し、Notionの日時変更は確認して取り込める',async()=>{
 const f=fixture(),scheduled=desiredSchedule(f.booking,teacherId);
 f.booking.status='cancelled';f.booking.notion_baseline=scheduled;f.setPage(card(scheduled));
 assert.equal((await syncBensukeBooking({...f,sourceId:BENSUKE_SOURCE})).status,'synced');
 assert.deepEqual(f.patches[0].properties.内容,{multi_select:[{id:'本：予約可'}]});
 const changed={...scheduled,date:{start:'2026-12-01T14:00:00+09:00',end:'2026-12-01T14:45:00+09:00'}};
 const adopted=remoteAppointment({...f.booking,status:'confirmed'},changed,directory);assert.equal(adopted.start,'14:00');assert.equal(adopted.note,data.note);
 assert.throws(()=>remoteAppointment(f.booking,{...changed,title:'別の生徒'},directory),/氏名/);
 assert.ok(equivalentSchedule(scheduled,{...scheduled,date:{start:'2026-12-01T04:00:00Z',end:'2026-12-01T04:45:00Z'}}));
 assert.ok(equivalentSchedule(scheduled,Object.fromEntries(Object.entries(scheduled).reverse())));
 assert.equal(scheduleValue(card(),schema).title,'予約可');
});
