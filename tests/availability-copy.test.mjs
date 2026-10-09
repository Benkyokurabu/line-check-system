import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextWeekCopyRange, validateCopyRange, formatAvailabilityCopy} from '../src/lib/availability-copy-core.mjs';
import {copyTeacherOptions, readAvailabilityCopy} from '../src/lib/availability-copy-notion.mjs';
const teacherId='00000000-0000-4000-8000-000000000001';
const source='00000000-0000-4000-8000-000000000002';
const schema={properties:{'名前':{id:'title',type:'title'},'日時':{id:'date',type:'date'},'担当者':{id:'teacher',type:'relation',relation:{data_source_id:source}},'校舎':{id:'campus',type:'multi_select'},'教室':{id:'room',type:'select'},'内容':{id:'tag',type:'multi_select'}}};
function card(id,start,end,tags=['本：予約可'],teachers=[teacherId]) {return {id,properties:{'名前':{id:'title',title:[{plain_text:'予約可'}]},'日時':{id:'date',date:{start,end}},'担当者':{id:'teacher',relation:teachers.map(id=>({id}))},'校舎':{id:'campus',multi_select:[{name:'本校'}]},'教室':{id:'room',select:null},'内容':{id:'tag',multi_select:tags.map(name=>({name}))}}};}
function fixture(pages,{broken=false}={}) {
 const calls=[];
 const request=async(path,init={})=>{
  calls.push({path,...init});
  assert.ok(!init.method||init.method==='POST'&&path.endsWith('/query'),'No Notion mutations');
  if(!path.endsWith('/query'))return schema;
  if(path===`/data_sources/${source}/query`)return {results:[{id:teacherId,properties:{'氏名':{type:'title',title:[{plain_text:'工藤先生'}]}}}]};
  const body=JSON.parse(init.body);
  assert.equal(body.filter.and[0].relation.contains,teacherId);
  if(!body.start_cursor)return {results:pages.slice(0,1),has_more:pages.length>1,next_cursor:pages.length>1?'next':null};
  if(broken)throw Error('second page failed');
  return {results:pages.slice(1),has_more:false};
 };
 return {request,calls};
}
const actor={displayName:'工藤謙',staffCode:'KUDO'};
test('JSTで次週の月曜〜土曜を求める。月末・日曜・月曜・年末',()=>{
 assert.deepEqual(nextWeekCopyRange(new Date('2026-10-09T02:00Z')),{from:'2026-10-12',to:'2026-10-17'});
 assert.deepEqual(nextWeekCopyRange(new Date('2026-10-25T14:00Z')),{from:'2026-10-26',to:'2026-10-31'});
 assert.deepEqual(nextWeekCopyRange(new Date('2026-10-25T15:00Z')),{from:'2026-11-02',to:'2026-11-07'});
 assert.deepEqual(nextWeekCopyRange(new Date('2026-12-31T02:00Z')),{from:'2027-01-04',to:'2027-01-09'});
});
test('実在する日付と31日以内の期間だけ受付',()=>{
 assert.deepEqual(validateCopyRange('2026-10-26','2026-11-07'),{from:'2026-10-26',to:'2026-11-07'});
 for(const range of [['2026-02-30','2026-03-01'],['2026-10-10','2026-10-09'],['2026-10-01','2026-11-01'],['','']])assert.throws(()=>validateCopyRange(...range));
});
test('日時順・曜日・丸数字・終了時刻なしを正確に整形',()=>{
 assert.equal(formatAvailabilityCopy([{date:'2026-10-14',start:'22:05',end:''},{date:'2026-10-12',start:'14:00',end:'14:45'}]),'① 10月12日（月）14:00〜14:45\n② 10月14日（水）22:05〜（終了時刻なし）');
 const rows=Array.from({length:51},()=>({date:'2026-10-12',start:'14:00',end:'14:45'}));
 const text=formatAvailabilityCopy(rows).split('\n');assert.ok(text[20].startsWith('㉑'));assert.ok(text[35].startsWith('㊱'));assert.ok(text[49].startsWith('㊿'));assert.ok(text[50].startsWith('（51）'));
});
test('Notion職員IDで本人を選び全ページを読む。予約済み・重複・期間外・複数担当を除く',async()=>{
 const pages=[card('a','2026-10-12T14:00:00+09:00','2026-10-12T14:45:00+09:00'),card('b','2026-10-14T06:00:00Z','2026-10-14T06:45:00Z'),card('duplicate','2026-10-12T14:00:00+09:00','2026-10-12T14:45:00+09:00'),card('reserved','2026-10-12T15:00:00+09:00','2026-10-12T15:45:00+09:00',['面談(対面)']),card('outside','2026-10-19T14:00:00+09:00','2026-10-19T14:45:00+09:00'),card('multi','2026-10-12T16:00:00+09:00','2026-10-12T16:45:00+09:00',['本：予約可'],[teacherId,'other'])];
 const {request,calls}=fixture(pages),options=await copyTeacherOptions(request,actor);assert.equal(options.defaultTeacherId,teacherId);
 const result=await readAvailabilityCopy({request,from:'2026-10-12',to:'2026-10-17',teacherId,actor});
 assert.equal(result.rows.length,2);assert.equal(result.reviewCount,1);assert.equal(result.text,'① 10月12日（月）14:00〜14:45\n② 10月14日（水）15:00〜15:45');assert.ok(calls.some(c=>c.body?.includes('next')));
});
test('期間前から続く休み・同時間の面談を除き、境界が接する枠は残す',async()=>{
 const pages=[card('a','2026-10-12T14:00:00+09:00','2026-10-12T14:45:00+09:00'),card('b','2026-10-14T15:00:00+09:00','2026-10-14T15:45:00+09:00'),card('c','2026-10-14T16:00:00+09:00','2026-10-14T16:45:00+09:00'),card('holiday','2026-10-10','2026-10-12',['休み']),card('interview','2026-10-14T15:00:00+09:00','2026-10-14T16:00:00+09:00',['面談(対面)'])];
 const {request}=fixture(pages),result=await readAvailabilityCopy({request,from:'2026-10-12',to:'2026-10-17',teacherId,actor});assert.equal(result.conflictCount,2);assert.equal(result.rows[0].start,'16:00');
});
test('未知の先生・途中取得失敗では一覧を返さない',async()=>{
 const {request}=fixture([card('a','2026-10-12T14:00:00+09:00','2026-10-12T14:45:00+09:00'),card('b','2026-10-13T14:00:00+09:00','2026-10-13T14:45:00+09:00')],{broken:true});
 await assert.rejects(readAvailabilityCopy({request,from:'2026-10-12',to:'2026-10-17',teacherId:'unknown',actor}),/先生/);
 await assert.rejects(readAvailabilityCopy({request,from:'2026-10-12',to:'2026-10-17',teacherId,actor}),/second page/);
});
