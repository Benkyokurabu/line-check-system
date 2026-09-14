import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBensukeDay,findBensukeSource} from '../src/lib/bensuke-reader.mjs';
const id='11111111-1111-1111-1111-111111111111';
const schema={id,title:[{plain_text:'ベンスケDB'}],properties:{名前:{id:'title',type:'title'},日時:{id:'date',type:'date'},担当者:{id:'teacher',type:'multi_select'}}};
const card={id,properties:{renamed:{id:'title',type:'title',title:[{plain_text:'既存の面談'}]},date:{id:'date',type:'date',date:{start:'2026-09-14T13:00:00+09:00',end:null}},teacher:{id:'teacher',type:'multi_select',multi_select:[{name:'講師A'}]}},last_edited_time:'2026-09-13T00:00:00Z'};
test('既存カードは追加IDなしで読み取り、プロパティIDで値を照合する',async()=>{
 const calls=[];
 const result=await readBensukeDay({date:'2026-09-14',request:async(path,init)=>{calls.push([path,init]);if(path==='/search')return {results:[schema]};if(path.endsWith('/query'))return {results:[card]};return schema;}});
 assert.equal(result.rows[0].title,'既存の面談');assert.equal(result.rows[0].fields[0].value,'講師A');
 assert.equal(result.readOnly,true);assert.equal(calls.length,3);
 assert.deepEqual(JSON.parse(calls[2][1].body).filter,{property:'date',date:{equals:'2026-09-14'}});
 assert.ok(calls.every(([p,o])=>!o||o.method==='POST'&&(p==='/search'||p.endsWith('/query'))));
});
test('接続不可・同名複数を空予定として扱わず停止する',async()=>{
 await assert.rejects(()=>findBensukeSource(async()=>({results:[]})),/読み取れません/);
 await assert.rejects(()=>findBensukeSource(async()=>({results:[schema,{...schema,id:'22222222-2222-2222-2222-222222222222'}]})),/複数/);
 await assert.rejects(()=>readBensukeDay({date:'2026-09-14',sourceId:id,request:async()=>{throw Error('offline');}}),/offline/);
});
test('全ページを取得し、アーカイブを除外する',async()=>{
 let count=0;
 const result=await readBensukeDay({date:'2026-09-14',sourceId:id,request:async(path,init)=>{
  if(!init)return schema;count++;const body=JSON.parse(init.body);
  if(count===1){assert.equal(body.start_cursor,undefined);return {results:[card],has_more:true,next_cursor:'next'};}
  assert.equal(body.start_cursor,'next');return {results:[{...card,archived:true}],has_more:false};
 }});assert.equal(result.rows.length,1);assert.equal(count,2);
});
test('不正日付・不足項目・壊れたページングを検出し部分結果を返さない',async()=>{
 await assert.rejects(()=>readBensukeDay({date:'2026-02-30',request:()=>assert.fail('must not fetch')}),/日付/);
 await assert.rejects(()=>readBensukeDay({date:'2026-09-14',sourceId:id,request:async()=>({...schema,properties:{}})}),/項目/);
 await assert.rejects(()=>readBensukeDay({date:'2026-09-14',sourceId:id,request:async(p,o)=>o?{results:[card],has_more:true,next_cursor:'same'}:schema}),/途中/);
});
test('名前だけが似たDBを選ばず、指定接続先の失敗で別DBに切り替えない',async()=>{
 await assert.rejects(()=>findBensukeSource(async()=>({results:[{...schema,title:[{plain_text:'ベンスケDBの控え'}]}]})),/読み取れません/);
 const calls=[];await assert.rejects(()=>findBensukeSource(async path=>{calls.push(path);throw Error('denied');},id),/denied/);assert.deepEqual(calls,[`/data_sources/${id}`]);
});
