import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSurveyStudentProfile} from '../src/lib/survey-student-profile.mjs';

const number='2019999';
const profile={id:'student-page',properties:{'学籍番号':{number:Number(number)}}};
function fixture({relation=[],registry=null,mapping=null,results=[profile],has_more=false,error=null}={}){
 const reads=[],calls=[];
 const db={from(table){
  reads.push(table);
  const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return query;},
   async maybeSingle(){return {data:table==='student_registry'?registry:mapping,error};}};
  return query;
 }};
 const request=async(path,init)=>{calls.push({path,init});return path.startsWith('/pages/')?results[0]:{results,has_more};};
 return {reads,calls,run:()=>resolveSurveyStudentProfile({db,request,page:{properties:{'生徒情報DB':{relation}}},number,source:'student-source'})};
}
test('missing answer relation and both local mappings resolve by exact Notion student number without writing',async()=>{
 const f=fixture();assert.deepEqual(await f.run(),profile);
 assert.deepEqual(f.reads,['student_registry','notion_student_profiles']);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/data_sources/student-source/query');
 assert.deepEqual(JSON.parse(f.calls[0].init.body),{page_size:2,filter:{and:[{property:'学籍番号',number:{equals:2019999}},{property:'状態',select:{equals:'在塾'}}]}});
});
test('an explicit answer relation remains authoritative',async()=>{
 const f=fixture({relation:[{id:profile.id}]});assert.equal((await f.run()).id,profile.id);
 assert.deepEqual(f.reads,[]);assert.equal(f.calls[0].path,'/pages/student-page');
});
for(const source of ['registry','mapping'])test(`existing ${source} mapping avoids a live source search`,async()=>{
 const f=fixture({[source]:{notion_page_id:profile.id}});await f.run();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/pages/student-page');
});
test('multiple answer relations stop before choosing or querying a student',async()=>{
 const f=fixture({relation:[{id:'a'},{id:'b'}]});await assert.rejects(f.run(),{status:409});assert.deepEqual(f.calls,[]);
});
for(const result of [{results:[]},{results:[profile,profile]},{has_more:true},{results:[{...profile,properties:{'学籍番号':{number:1}}}]},{results:[{...profile,archived:true}]},{results:[{...profile,in_trash:true}]}])
 test(`unavailable, ambiguous or mismatched originals cannot be used: ${JSON.stringify(result)}`,async()=>{
  await assert.rejects(fixture(result).run(),{status:409});
 });
test('a wrong explicit relation is rejected without falling back to another student',async()=>{
 const f=fixture({relation:[{id:'wrong'}],results:[{...profile,properties:{'学籍番号':{number:1}}}]});
 await assert.rejects(f.run(),{status:409});assert.equal(f.calls.length,1);
});
test('mapping access failures are surfaced without a blind fallback',async()=>{
 const f=fixture({error:{code:'unavailable'}});await assert.rejects(f.run(),{status:503});assert.deepEqual(f.calls,[]);
});
