import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bookingProperties,syncBookingToNotion} from '../src/lib/interview-notion.mjs';
const schema={properties:Object.fromEntries(['名前','日時','担当者','校舎','内容','予約ID','勉たん生徒ID'].map((name,i)=>[name,{id:String(i),name,type:name==='名前'?'title':name==='日時'?'date':'rich_text'}]))};
const booking={id:'booking1',status:'confirmed',data:{studentId:'student1',studentName:'架空生徒',date:'2026-11-02',start:'13:00',end:'13:45',teacher:'架空講師',campus:'本校',method:'Zoom',note:'機密メモ',record:{content:'非公開の下書き'}}};
test('公開するのは予定情報だけ。機密メモ・下書きを同期しない',()=>{
 const p=bookingProperties(booking,schema);const str=JSON.stringify(p);
 assert.ok(str.includes('面談：架空生徒（オンライン）'));assert.ok(!str.includes('機密メモ'));assert.ok(!str.includes('非公開の下書き'));
 assert.equal(p['1'].date.end,'2026-11-02T13:45:00+09:00');
});
test('項目が変わった場合は書き込まず停止',()=>assert.throws(()=>bookingProperties(booking,{properties:{}})));
test('Notionで変更・削除されたカードを無条件に上書きしない',async()=>{
 for(const patch of [{archived:true},{last_edited_time:'new'}]){
 const r=await syncBookingToNotion({booking:{...booking,notion_page_id:'page1',notion_edited_at:'old'},sourceId:'source1',request:async(path,options)=>{
 assert.ok(!options);return path.startsWith('/data_sources/')?schema:{...patch,properties:{x:{id:'5',rich_text:[{plain_text:'booking1'}]}}};
 }});assert.equal(r.status,'review');
 }
});
test('通信断で新規登録の結果が不明な場合は自動再作成しない',async()=>{
 let creates=0;const request=async(path)=>{if(path.endsWith('/query'))return {results:[]};if(path==='/pages'){creates++;throw Error('connection lost');}return schema;};
 const result=await syncBookingToNotion({booking,sourceId:'s',request});assert.equal(result.status,'uncertain');
 await assert.rejects(()=>syncBookingToNotion({booking:{...booking,sync_error:'create_uncertain'},sourceId:'s',request}));assert.equal(creates,1);
});
