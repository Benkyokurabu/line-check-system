import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as xlsx from 'xlsx';
import * as guard from '../src/lib/student-import-guard.mjs';
import * as roster from '../src/lib/roster-import-logic.mjs';
import * as linking from '../src/lib/student-linking.ts';

const source=fs.readFileSync(new URL('../src/lib/notion-roster-sync.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function fixture({numbers=['2015999','2018998','2019000','2020999'],existing=[],duplicate=false}={}){
 const pages=numbers.map((number,index)=>({id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,properties:{
  '学籍番号':{type:'number',number:Number(number)},'生徒氏名':{type:'title',title:[{plain_text:`架空 生徒${index}`}]},
  '状態':{type:'select',select:{name:'在塾'}},'学年':{type:'formula',formula:{type:'string',string:'中３'}},
 }}));
 if(duplicate)pages.push({...pages[0],id:'00000000-0000-4000-8000-999999999999'});
 const writes=[],queries=[];
 const db={from(table){
  const data=table==='student_roster'?existing:[];
  const query={select(){return query;},eq(){return query;},in(){return query;},range:async()=>({data,error:null}),
   maybeSingle:async()=>({data:null,error:null}),
   then(resolve,reject){return Promise.resolve({data,error:null}).then(resolve,reject);},
   upsert:async rows=>{writes.push({table,rows});return {error:null};},
   delete(){writes.push({table,delete:true});return query;},insert:async rows=>{writes.push({table,rows});return {error:null};}};
  return query;
 }};
 const request=async(url,init)=>{
  assert.match(url,/^\/data_sources\/[^/]+\/query$/);
  const body=JSON.parse(init.body);queries.push(body);
  assert.deepEqual(body.filter,{or:['在塾','見学中'].map(status=>({property:'状態',select:{equals:status}}))});
  return {results:pages,has_more:false};
 };
 const exports={};
 vm.runInNewContext(code,{exports,process,Date,Map,Set,Promise,require(name){
  const modules={'server-only':{},'node:fs':fs,'node:path':path,xlsx,'@/lib/student-import-guard.mjs':guard,
   '@/lib/roster-import-logic.mjs':roster,'@/lib/student-linking':linking,'@/lib/notion':{notionRequest:request}};
  if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];
 }});
 return {api:exports,db,writes,queries,numbers};
}
function root(){return fs.mkdtempSync(path.join(os.tmpdir(),'notion-sync-no-cutoff-'));}

test('scheduled sync saves profiles below and at the former cutoff, retaining the status filter',async()=>{
 const f=fixture();const result=await f.api.syncActiveNotionStudents({supabase:f.db});
 assert.equal(result.synced_students,4);
 for(const table of ['student_roster','notion_student_profiles']){
  const write=f.writes.find(x=>x.table===table);assert.deepEqual(write.rows.map(x=>x.student_number),f.numbers);
 }
});
test('manual sync accepts older numbers and creates their Notion mapping',async()=>{
 const f=fixture();const result=await f.api.syncSelectedRosterStudents({supabase:f.db,root:root(),studentNumbers:['2018998']});
 assert.equal(result.synced_students,1);
 assert.deepEqual(Array.from(f.writes.find(x=>x.table==='notion_student_profiles').rows,x=>x.student_number),['2018998']);
});
test('preview includes older Notion and app students and declares the active statuses',async()=>{
 const f=fixture({existing:[{student_number:'2014999',student_name:'架空 既存生徒',grade:'高３',source_file:'Notion生徒情報DB'}]});
 const result=await f.api.buildRosterSyncPreview({supabase:f.db,root:root()});
 assert.deepEqual(JSON.parse(JSON.stringify(result.target)),{notion_statuses:['在塾','見学中']});
 for(const number of [...f.numbers,'2014999'])assert.ok(result.candidates.some(x=>x.student_number===number));
 assert.deepEqual(f.writes,[]);
});
test('Excel preview and selected sync keep older-number class enrollments',async()=>{
 const dir=root(),book=xlsx.utils.book_new();
 xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([['クラス一覧表'],['所属','学籍番号','氏名'],['本校',2018998,'架空 生徒1','女','学校','工藤','1','A']]),'クラス一覧表');
 xlsx.writeFile(book,path.join(dir,'中３ クラス一覧表.xlsx'));
 const f=fixture();const preview=await f.api.buildRosterSyncPreview({supabase:f.db,root:dir});
 assert.equal(preview.excel.students,1);assert.ok(preview.candidates.find(x=>x.student_number==='2018998').excel);
 const saved=await f.api.syncSelectedRosterStudents({supabase:f.db,root:dir,studentNumbers:['2018998']});
 assert.equal(saved.synced_students,1);assert.equal(saved.synced_class_enrollments,1);
 assert.equal(f.writes.find(x=>x.table==='student_class_enrollments'&&x.rows).rows[0].student_number,'2018998');
});
test('removing the cutoff still holds duplicate Notion student numbers instead of saving them',async()=>{
 const f=fixture({numbers:['2018998'],duplicate:true});
 const result=await f.api.syncActiveNotionStudents({supabase:f.db});assert.equal(result.synced_students,0);
 assert.deepEqual(Array.from(result.identity_review.held_student_numbers),['2018998']);
 assert.equal(f.writes.some(x=>['student_roster','notion_student_profiles'].includes(x.table)),false);
});
test('removing the cutoff still holds a name mismatch on the same student number',async()=>{
 const f=fixture({numbers:['2018998'],existing:[{student_number:'2018998',student_name:'架空 別の生徒'}]});
 const result=await f.api.syncActiveNotionStudents({supabase:f.db});assert.equal(result.synced_students,0);
 assert.equal(f.writes.some(x=>x.table==='notion_student_profiles'),false);
});
