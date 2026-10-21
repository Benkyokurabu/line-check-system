import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
import {parentContactRow,normalizeParentWorkLog,parentRowMatches,parentRowBlank,parentContactTeacherName,parentContactTeacherChoice,parentContactOptionIssues} from '../src/lib/parent-contact-core.mjs';import {syncParentContactLog} from '../src/lib/parent-contact-sync.mjs';
const options={teachers:['工藤先生'],tasks:['保護者面談'],contents:['定期面談行事'],results:['解決']};
const payload=()=>({fields:{date:{state:'confirmed',value:'2026-10-19'}},workLog:{enabled:true,teacher:'工藤先生',task:'保護者面談',start:'16:05',end:'16:40',contact:'見本の生徒+母',content:'定期面談行事',result:'解決'}});
test('ログイン者の旧初期値だけをExcelの氏名に合わせ、他の氏名や不明な候補を推測しない',()=>{
 const staff={staffCode:'KUDO',displayName:'工藤謙'};assert.equal(parentContactTeacherName(staff),'工藤先生');
 assert.equal(parentContactTeacherChoice('工藤謙先生',options.teachers,staff),'工藤先生');
 for(const current of ['','別の先生','工藤先生'])assert.equal(parentContactTeacherChoice(current,options.teachers,staff),current);
 assert.equal(parentContactTeacherChoice('工藤謙先生',['工藤謙先生','工藤先生'],staff),'工藤謙先生');
 assert.equal(parentContactTeacherChoice('工藤謙先生',[],staff),'工藤謙先生');
 assert.equal(parentContactTeacherChoice('工藤謙先生',options.teachers,{staffCode:'KUDO',displayName:'工藤'}),'工藤謙先生');
 const p=payload();p.workLog.teacher='工藤謙先生';assert.deepEqual(parentContactOptionIssues(p.workLog,options),[{key:'teacher',label:'氏名',value:'工藤謙先生'}]);assert.throws(()=>parentContactRow(p,options),/「氏名」（工藤謙先生）/);
 p.workLog.teacher=parentContactTeacherChoice(p.workLog.teacher,options.teachers,staff);assert.equal(parentContactRow(p,options).values[1],'工藤先生');
});
test('原本の項目に合わせ、未確定日付・未入力・時刻逆転・選択肢違いを記入しない',()=>{
 const p=payload(),row=parentContactRow(p,options);assert.equal(row.values[0],'19日');assert.equal(row.values[3],965/1440);assert.equal(row.values[5],1000/1440);assert.equal(row.values[4],null);assert.equal(row.values[6],null);assert.equal(row.duration,35/1440);assert.equal(normalizeParentWorkLog().enabled,false);
 for(const edit of [p=>p.fields.date.state='review',p=>p.workLog.start='',p=>p.workLog.end='16:00',p=>p.workLog.task='別の摘要']){const changed=payload();edit(changed);assert.throws(()=>parentContactRow(changed,options));}
 assert.ok(parentRowBlank(['','','','', '～','','=G5-E5','','','']));assert.ok(parentRowMatches(['19日','工藤先生','保護者面談','16:05','～','16:40',35/1440,'見本の生徒+母','定期面談行事','解決'],row.values));
});
function fixture(){let reservation=null,writes=0,locked=false,loseResponse=false;const rows=[['日付','氏名','摘要','開始','～','終了','時間','生徒名+父か母','内容','結果'],...Array.from({length:200},()=>['','','','','～','','','','',''])];const checkpoints=[];
 const db={rpc:async(name)=>{if(name==='claim_parent_contact_workbook'){if(locked)return {data:null};locked=true;return {data:'lease'};}locked=false;return {data:true};},from:()=>{let filter={},update,insert;const chain={select:()=>chain,eq:(k,v)=>{filter[k]=v;return chain;},limit:async()=>({data:reservation?[reservation]:[]}),maybeSingle:async()=>({data:reservation}),insert:value=>{insert=value;return chain;},single:async()=>{reservation={...insert};return {data:reservation};},update:value=>{update=value;return chain;},then:resolve=>{if(reservation&&(!filter.entry_id||filter.entry_id===reservation.entry_id))Object.assign(reservation,update);return Promise.resolve({data:null}).then(resolve);}};return chain;}};
 const cloud={find:async()=>({id:'file',drive:'drive',name:'原本.xlsx',url:'https://onedrive.live.com/edit'}),options:async()=>options,read:async()=>({values:structuredClone(rows)}),write:async(_file,row,values)=>{writes++;rows[row-4]=values.map((v,i)=>i===4?'～':i===6?35/1440:v);if(loseResponse){loseResponse=false;throw Error('Response lost');}return structuredClone(rows[row-4]);}};
 const entry={id:'entry',targets:{workLog:{status:'pending'},lines:{}},payload:payload()};const run=()=>syncParentContactLog({db,entry,checkpoint:async targets=>{checkpoints.push(structuredClone(targets));return true;},makeCloud:async()=>cloud});
 return {entry,rows,run,cloud,get reservation(){return reservation;},get writes(){return writes;},lose:()=>{loseResponse=true;},lock:()=>{locked=true;}};
}
test('応答喪失後も予約行を照合し、追記や二重記入をしない',async()=>{const f=fixture();f.lose();await f.run();assert.equal(f.entry.targets.workLog.status,'retry');assert.equal(f.writes,1);assert.equal(f.reservation.row_number,5);await f.run();assert.equal(f.entry.targets.workLog.status,'synced');assert.equal(f.writes,1);await f.run();assert.equal(f.writes,1);});
test('別の記入・原本変更・ロック・入力不足は上書きせず保留する',async()=>{
 let f=fixture();f.lose();await f.run();f.rows[1][7]='他の記入';await f.run();assert.equal(f.entry.targets.workLog.status,'review');assert.equal(f.writes,1);
 f=fixture();f.entry.payload.workLog.end='';await f.run();assert.equal(f.entry.targets.workLog.status,'review');assert.equal(f.writes,0);assert.match(f.entry.targets.workLog.error,/終了時刻/);
 f=fixture();f.lock();await f.run();assert.equal(f.entry.targets.workLog.status,'retry');assert.equal(f.writes,0);
 f=fixture();await f.run();f.entry.targets.workLog.status='pending';f.cloud.find=async()=>({id:'different',drive:'drive'});await f.run();assert.equal(f.entry.targets.workLog.status,'review');assert.equal(f.writes,1);
});
test('案件ごとの記入行予約・排他・権限をDBで保護する',async()=>{const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create table post_interview_entries(id uuid primary key);');const sql=fs.readFileSync('supabase/parent_contact_workbook_20261019.sql','utf8');await db.exec(sql);await db.exec(sql);
 const first=(await db.query('select claim_parent_contact_workbook() lease')).rows[0].lease;assert.ok(first);assert.equal((await db.query('select claim_parent_contact_workbook() lease')).rows[0].lease,null);assert.equal((await db.query("select release_parent_contact_workbook('00000000-0000-4000-8000-000000000000') ok")).rows[0].ok,false);assert.equal((await db.query('select release_parent_contact_workbook($1) ok',[first])).rows[0].ok,true);
 await db.exec('set role anon');await assert.rejects(db.query('select claim_parent_contact_workbook()'),/permission denied/);await assert.rejects(db.query('select * from parent_contact_log_rows'),/permission denied/);await db.exec('reset role');
 await db.exec("insert into post_interview_entries values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');insert into parent_contact_log_rows(entry_id,drive_id,item_id,row_number,expected,fingerprint) values('00000000-0000-4000-8000-000000000001','d','i',5,'[]','hash')");await assert.rejects(db.exec("insert into parent_contact_log_rows(entry_id,drive_id,item_id,row_number,expected,fingerprint) values('00000000-0000-4000-8000-000000000002','d','i',5,'[]','hash')"),/unique/);
 }finally{await db.close();}});
