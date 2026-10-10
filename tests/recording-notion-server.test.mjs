import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as core from '../src/lib/recording-notion-core.mjs';
import {publicRecordingRules} from '../src/lib/recording-publication.mjs';
const key='2026-10-01|18:00～19:00|hon|hon_j1_S_math|2';
const ids=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'];
function progress(campus,id,ready){return {id,parent:{data_source_id:core.recordingProgressSources[0].id},properties:{'授業':{title:[{plain_text:'数学1S'}]},'クラス':{rich_text:[{plain_text:'1S'}]},'教室':{select:{name:campus}},'科目':{select:{name:'数学'}},'欠席なし':{type:'checkbox',checkbox:ready},'振替者採点・入力':{type:'checkbox',checkbox:false}}};}
function range(campus,date){return {id:campus,parent:{data_source_id:core.recordingRangeSource},properties:{'授業名':{title:[{plain_text:campus+'1S数'}]},'校舎':{select:{name:campus==='本'?'本校':'南教室'}},'実施日':{date:{start:date}},'テスト名':{select:{name:'単元テスト③'}}}};}
function englishRange(klass,date,campus='南教室'){return {id:klass+date+campus,parent:{data_source_id:core.recordingRangeSource},properties:{'授業名':{title:[{plain_text:'６'+klass+'英'}]},'校舎':{select:{name:campus}},'実施日':{date:{start:date}},'テスト名':{select:{name:'単元テスト③'}}}};}
function server({ready=false,fail=false,rangeFail=false,missing=false,malformed=false,rangeRows=null}={}){
 const exports={};let calls=0;
 const code=ts.transpileModule(fs.readFileSync('src/lib/recording-notion.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>name==='server-only'?{}:core,process:{env:{NOTION_TOKEN:'test-only'}},Date,Map,Set,Promise,AbortSignal,fetch:async url=>{
  calls++;
  if(url.includes(core.recordingRangeSource))return {ok:!rangeFail,json:async()=>({results:rangeRows ?? [range('本','2026-10-01'),range('南','2026-10-05')],has_more:false})};
  return {ok:!fail,json:async()=>({results:[progress('本校',ids[0],true),...missing?[]:[progress('南教室',ids[1],ready)]],...malformed?{}:{has_more:false}})};
 }});
 return {api:exports,calls:()=>calls};
}
test('automatic and saved Notion policies use the same shared-campus gate and preserve manual modes',async()=>{
 for(const ready of [false,true]){
  const {api}=server({ready});
  const automatic=await api.automaticTestRules();assert.equal(automatic.length,2);
  assert(automatic.every(rule=>rule.status===(ready?'public':'hidden')));
  const resolved=await api.resolveNotionRules([{event_key:key,mode:'notion',notion_page_id:ids[0]},{event_key:key,mode:'private'},{event_key:key,mode:'public'}]);
  assert.equal(resolved[0].notion_ready,ready);assert.equal(resolved[0].notion_checks.length,2);
  assert.equal(resolved[1].mode,'private');assert.equal(resolved[2].mode,'public');
 }
});
test('automatic captured rules recover a previously missing progress link without URL recapture',async()=>{
 const {api}=server({ready:true});
 const [resolved]=await api.resolveNotionRules([{event_key:key,mode:'notion',automatic:true,notion_page_id:null}]);
 assert.equal(resolved.notion_ready,true);
});
test('Notion failures, incomplete lists and missing counterpart never publish test recordings',async()=>{
 for(const options of [{fail:true},{missing:true},{malformed:true}]){
  const {api}=server(options);assert((await api.automaticTestRules()).every(rule=>rule.status==='hidden'));
  assert.equal((await api.resolveNotionRules([{event_key:key,mode:'notion',notion_page_id:ids[0]}]))[0].notion_ready,false);
 }
 const {api}=server({rangeFail:true});await assert.rejects(api.automaticTestRules());
 assert.equal((await api.resolveNotionRules([{event_key:key,mode:'notion',notion_page_id:ids[0]}]))[0].notion_ready,false);
});
test('linked row validation rejects wrong campus and snapshot reads are cached',async()=>{
 const {api,calls}=server({ready:true});
 await api.readLinkedProgress(key,ids[0]);await assert.rejects(api.readLinkedProgress(key,ids[1]));
 await api.automaticTestRules();await api.automaticTestRules();assert.equal(calls(),2);
});

test('a moved automatic test releases only its former lesson; new test and unchanged class stay gated',async()=>{
 const oldA='2026-10-09|4:55～6:15|minami|minami_e6_A_eng|2';
 const oldS='2026-10-09|4:55～6:15|minami|minami_e6_S_eng|1';
 const {api}=server({rangeRows:[englishRange('Ａ','2026-10-16'),englishRange('Ｓ','2026-10-09')]});
 const [a,s,manual,privateRule]=await api.resolveNotionRules([
  {event_key:oldA,mode:'notion',automatic:true,notion_page_id:null},
  {event_key:oldS,mode:'notion',automatic:true,notion_page_id:null},
  {event_key:oldA,mode:'notion',automatic:false,notion_page_id:ids[0]},
  {event_key:oldA,mode:'private',automatic:false},
 ]);
 assert.equal(a.notion_ready,true);
 assert.equal(s.notion_ready,false);
 assert.equal(manual.notion_ready,false);
 assert.equal(privateRule.mode,'private');
 const release=publicRecordingRules([
  {...a,event_keys:[oldA],source_url:'https://example.test/a',source_urls:['https://example.test/a']},
  {...s,event_keys:[oldS],source_url:'https://example.test/s',source_urls:['https://example.test/s']},
  {...privateRule,event_keys:[oldA],source_url:'https://example.test/private',source_urls:['https://example.test/private']},
 ]);
 assert.equal(release[0].status,'public');assert.equal(release[0].url,'https://example.test/a');
 assert.equal(release[1].status,'hidden');assert.equal(release[1].url,'');
 assert.equal(release[2].status,'hidden');assert.equal(release[2].url,'');
 const automatic=await api.automaticTestRules();
 assert.deepEqual(Array.from(automatic,rule=>[rule.match.date,rule.match.group,rule.status]),[
  ['2026-10-16','minami_e6_A_eng','hidden'],
  ['2026-10-09','minami_e6_S_eng','hidden'],
 ]);
});

test('moved-test release requires one verified range for the same class, campus and test',async()=>{
 const oldA='2026-10-09|4:55～6:15|minami|minami_e6_A_eng|2';
 const rule={event_key:oldA,mode:'notion',automatic:true,notion_page_id:null};
 for(const rows of [
  [englishRange('Ａ','2026-10-08')],
  [englishRange('Ａ','2026-10-16')],
 ])assert.equal((await server({rangeRows:rows}).api.resolveNotionRules([rule]))[0].notion_ready,true);
 for(const rows of [
  [],[englishRange('Ａ','2026-10-09')],
  [englishRange('Ｓ','2026-10-16')],
  [englishRange('Ａ','2026-10-16','本校')],
  [englishRange('Ａ','2026-10-16'),englishRange('Ａ','2026-10-23')],
 ])assert.equal((await server({rangeRows:rows}).api.resolveNotionRules([rule]))[0].notion_ready,false);
 assert.equal((await server({rangeFail:true}).api.resolveNotionRules([rule]))[0].notion_ready,false);
 assert.equal((await server({fail:true,rangeRows:[englishRange('Ａ','2026-10-16')]}).api.resolveNotionRules([rule]))[0].notion_ready,false);
});
