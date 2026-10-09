import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextWeekCopyRange, validateCopyRange, formatAvailabilityCopy} from '../src/lib/availability-copy-core.mjs';
import {copyTeacherOptions, readAvailabilityCopy} from '../src/lib/availability-copy-notion.mjs';
const teacherId='00000000-0000-4000-8000-000000000001';
const source='00000000-0000-4000-8000-000000000002';
const schema={properties:{'名前':{id:'title',type:'title'},'日時':{id:'date',type:'date'},'担当者':{id:'teacher',type:'relation',relation:{data_source_id:source}},'校舎':{id:'campus',type:'multi_select'},'教室':{id:'room',type:'select'},'内容':{id:'tag',type:'multi_select'}}};
function card(id,start,end,tags=['本：予約可'],teachers=[teacherId]) {return {id,properties:{'名前':{id:'title',title:[{plain_text:'予約可'}]},'日時':{id:'date',date:{start,end}},'担当者':{id:'teacher',relation:teachers.map(id=>({id}))},'校舎':{id:'campus',multi_select:[{name:'本校'}]},'教室':{id:'room',select:null},'内容':{id:'tag',multi_select:tags.map(name=>({name}))}}};}
function fixture(pages,{broken=false,staff=[{id:teacherId,name:'工藤先生'}]}={}) {
 const calls=[];
 const request=async(path,init={})=>{
  calls.push({path,...init});
  assert.ok(!init.method||init.method==='POST'&&path.endsWith('/query'),'No Notion mutations');
  if(!path.endsWith('/query'))return schema;
  if(path===`/data_sources/${source}/query`)return {results:staff.map(person=>({id:person.id,properties:{'氏名':{type:'title',title:[{plain_text:person.name}]}}}))};
  const body=JSON.parse(init.body);
  assert.equal(body.filter.and[0].relation.contains,teacherId);
  assert.deepEqual(body.filter.and.slice(1),[
   {property:'date',date:{on_or_after:'2026-10-12T00:00:00+09:00'}},
   {property:'date',date:{on_or_before:'2026-10-17T23:59:59+09:00'}},
   {or:[{property:'tag',multi_select:{contains:'本：予約可'}},{property:'tag',multi_select:{contains:'南：予約可'}}]},
  ],'Only query reservation-available cards in the selected JST period, not all historical events');
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
test('Notion職員IDで本人を選び全ページを読む。重複・期間外・予約可以外を除く',async()=>{
 const pages=[card('a','2026-10-12T14:00:00+09:00','2026-10-12T14:45:00+09:00'),card('b','2026-10-14T06:00:00Z','2026-10-14T06:45:00Z'),card('duplicate','2026-10-12T14:00:00+09:00','2026-10-12T14:45:00+09:00'),card('reserved','2026-10-12T15:00:00+09:00','2026-10-12T15:45:00+09:00',['面談(対面)']),card('outside','2026-10-19T14:00:00+09:00','2026-10-19T14:45:00+09:00'),card('multi','2026-10-12T16:00:00+09:00','2026-10-12T16:45:00+09:00',['本：予約可'],[teacherId,'other'])];
 const {request,calls}=fixture(pages),options=await copyTeacherOptions(request,actor);assert.equal(options.defaultTeacherId,teacherId);
 const result=await readAvailabilityCopy({request,from:'2026-10-12',to:'2026-10-17',teacherId,actor});
 assert.equal(result.rows.length,3);assert.equal(result.reviewCount,0);assert.equal(result.text,'① 10月12日（月）14:00〜14:45\n② 10月12日（月）16:00〜16:45\n③ 10月14日（水）15:00〜15:45');assert.ok(calls.some(c=>c.body?.includes('next')));
});
test('期間をまたぐ休みや同時間の面談があっても、登録された予約可をそのまま一覧にする',async()=>{
 const pages=[card('a','2026-10-12T14:00:00+09:00','2026-10-12T14:45:00+09:00'),card('b','2026-10-14T15:00:00+09:00','2026-10-14T15:45:00+09:00'),card('c','2026-10-14T16:00:00+09:00','2026-10-14T16:45:00+09:00'),card('holiday','2026-10-10','2026-10-12',['休み']),card('interview','2026-10-14T15:00:00+09:00','2026-10-14T16:00:00+09:00',['面談(対面)'])];
 const {request}=fixture(pages),result=await readAvailabilityCopy({request,from:'2026-10-12',to:'2026-10-17',teacherId,actor});assert.equal(result.rows.length,3);assert.equal(result.rows[0].start,'14:00');assert.equal(result.rows[1].start,'15:00');assert.equal(result.reviewCount,0);
});
test('5名だけを指定順に選べる。髙山は別人の高山の職員IDと混ぜない',async()=>{
 const staff=[{id:'other',name:'その他先生'},{id:'takayama-alias',name:'高山先生'},{id:'suzuki',name:'鈴木先生'},{id:'kaneko',name:'金子先生'},{id:teacherId,name:'工藤先生'},{id:'takayama',name:'髙山先生'},{id:'kinjo',name:'金城先生'}];
 const {request,calls}=fixture([],{staff}),options=await copyTeacherOptions(request,actor);
 assert.deepEqual(options.teachers,[{id:'kinjo',name:'金城先生'},{id:teacherId,name:'工藤先生'},{id:'suzuki',name:'鈴木先生'},{id:'takayama',name:'髙山先生'},{id:'kaneko',name:'金子先生'}]);
 assert.equal(options.defaultTeacherId,teacherId);
 assert.equal((await copyTeacherOptions(request,{displayName:'その他',staffCode:'OTHER'})).defaultTeacherId,'');
 for(const id of ['other','takayama-alias'])await assert.rejects(readAvailabilityCopy({request,from:'2026-10-12',to:'2026-10-17',teacherId:id,actor}),/先生/);
 assert.equal(calls.filter(call=>call.path!==`/data_sources/${source}/query`&&call.path.endsWith('/query')).length,0);
});
test('予約可の枠の長さ・ほかのタグ・担当数を予約確定のルールで制限しない',async()=>{
 const pages=[card('hour','2026-10-12T14:00:00+09:00','2026-10-12T15:00:00+09:00',['本：予約可','休み']),card('short','2026-10-12T15:00:00+09:00','2026-10-12T15:30:00+09:00',['南：予約可'],[teacherId,'other']),card('open','2026-10-12T16:00:00+09:00',null),card('untimed','2026-10-12',null),card('overnight','2026-10-12T23:30:00+09:00','2026-10-13T00:30:00+09:00')];
 const {request}=fixture(pages),result=await readAvailabilityCopy({request,from:'2026-10-12',to:'2026-10-17',teacherId,actor});
 assert.equal(result.text,'① 10月12日（月）14:00〜15:00\n② 10月12日（月）15:00〜15:30\n③ 10月12日（月）16:00〜（終了時刻なし）');assert.equal(result.reviewCount,2);
});
test('未知の先生・途中取得失敗では一覧を返さない',async()=>{
 const {request}=fixture([card('a','2026-10-12T14:00:00+09:00','2026-10-12T14:45:00+09:00'),card('b','2026-10-13T14:00:00+09:00','2026-10-13T14:45:00+09:00')],{broken:true});
 await assert.rejects(readAvailabilityCopy({request,from:'2026-10-12',to:'2026-10-17',teacherId:'unknown',actor}),/先生/);
 await assert.rejects(readAvailabilityCopy({request,from:'2026-10-12',to:'2026-10-17',teacherId,actor}),/second page/);
});
