import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sharedProgressState} from '../src/lib/recording-notion-core.mjs';
const key='2026-10-01|18:00～19:00|hon|hon_j1_S_math|2';
const row=(campus,id,checks=0)=>({id,month:'2026-10',test:'2026.10 単元テスト③',testName:'単元テスト③',campus,class:'１Ｓ',subject:'数学',noAbsences:!!(checks&1),makeupComplete:!!(checks&2)});
const ranges=[{date:'2026-10-01',campus:'hon',group:'hon_j1_S_math',test:'単元テスト③'},{date:'2026-10-05',campus:'minami',group:'minami_j1_S_math',test:'単元テスト③'}];
test('all 16 checkbox combinations require OR within each campus and AND across campuses, in either direction',()=>{
 for(let hon=0;hon<4;hon++)for(let south=0;south<4;south++){
  const a=row('本校','a',hon),b=row('南教室','b',south),progress=[a,b];
  const expected=hon>0&&south>0;
  assert.equal(sharedProgressState(key,a,progress,ranges).ready,expected,`${hon}/${south}`);
  assert.equal(sharedProgressState(key.replaceAll('hon','minami').replace('10-01','10-05'),b,progress,ranges).ready,expected);
 }
});
test('missing and duplicate counterpart rows never count as completion',()=>{
 const a=row('本校','a',1),b=row('南教室','b',2);
 for(const progress of [[a],[a,b,{...b,id:'duplicate'}],[a,{...b,testName:'単元テスト②'}]]){
  const state=sharedProgressState(key,a,progress,ranges);assert.equal(state.ready,false);assert(state.error);
 }
 assert.equal(sharedProgressState(key,null,[a,b],ranges).ready,false);
});
test('other grades, classes, subjects and test rounds do not satisfy or block this test',()=>{
 const a=row('本校','a',1),b=row('南教室','b',2);
 const unrelated=[{...b,id:'class',class:'1A'},{...b,id:'grade',class:'2S'},{...b,id:'subject',subject:'英語'},{...b,id:'test',testName:'単元テスト②'}];
 assert.equal(sharedProgressState(key,a,[a,b,...unrelated],ranges).ready,true);
 for(const other of unrelated)assert.equal(sharedProgressState(key,a,[a,other],ranges).ready,false);
});
test('single-campus classes release when complete; a known opposite row still requires its completion',()=>{
 const a=row('本校','a',1),b=row('南教室','b',0);
 assert.equal(sharedProgressState(key,a,[a],ranges.slice(0,1)).ready,true);
 assert.equal(sharedProgressState(key,a,[a,b],ranges.slice(0,1)).ready,false);
 assert.equal(sharedProgressState(key,a,[a],ranges).ready,false);
});
test('unchecking either campus hides both recordings again',()=>{
 const a=row('本校','a',1),b=row('南教室','b',2);
 assert.equal(sharedProgressState(key,a,[a,b],ranges).ready,true);
 b.makeupComplete=false;assert.equal(sharedProgressState(key,a,[a,b],ranges).ready,false);
});
