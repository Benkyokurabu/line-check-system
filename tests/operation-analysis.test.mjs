import test from 'node:test';import assert from 'node:assert/strict';
import {analyzeOperation} from '../src/lib/operation-analysis.mjs';
const diagnostic={area:'attendance',method:'POST',symptom:'timeout',status:0,elapsedMs:45000,online:true};
test('AI receives actual diagnostic evidence and produces a separate inferred explanation',async()=>{
 let captured;
 const result=await analyzeOperation(diagnostic,{key:'fixture-key',fetcher:async(url,options)=>{
  assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(options.method,'POST');assert(options.signal);
  captured=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({assessment:'応答が遅れている可能性があります。内部の原因は不明です。',nextStep:'履歴や一覧で結果を確認してください。'})}}]})};
 }});
 assert.match(result.assessment,/可能性/);const user=JSON.parse(captured.messages.find(m=>m.role==='user').content);assert.deepEqual(user.observed,diagnostic);assert.match(user.facts.outcome,/判断できません/);
 assert.match(captured.messages[0].content,/根拠なく決めつけない/);assert.match(captured.messages[0].content,/未反映に見える場合も提案しない/);assert(!JSON.stringify(captured.messages).includes('fixture-key'));
});
test('missing keys and private/unrecognized input never cause a provider request',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error();};
 await assert.rejects(analyzeOperation(diagnostic,{fetcher}));await assert.rejects(analyzeOperation({...diagnostic,text:'PRIVATE'},{key:'fixture',fetcher}));assert.equal(calls,0);
});
test('provider failure, malformed JSON, missing output and generated links are rejected',async()=>{
 for(const response of [{ok:false,status:429},{ok:true,json:async()=>({})},{ok:true,json:async()=>({choices:[{message:{content:'not json'}}]})},{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({assessment:'a',nextStep:'https://outside.test'})}}]})}])await assert.rejects(analyzeOperation(diagnostic,{key:'fixture',fetcher:async()=>response}));
});
