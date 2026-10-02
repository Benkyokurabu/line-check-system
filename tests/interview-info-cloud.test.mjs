import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudInterviewSummary,interviewSummaryEngine} from '../src/lib/interview-info-cloud.mjs';
const fields=[{source:'記録',value:'次回までに候補校を家庭で確認する約束。'}];
test('cloud execution requires configured server credentials',()=>{
 assert.equal(interviewSummaryEngine({}),'local');assert.equal(interviewSummaryEngine({GROQ_API_KEY:'fixture'}),'cloud');
});
test('on-demand cloud summary returns verified original source text',async()=>{
 const result=await cloudInterviewSummary(fields,{key:'fixture',fetcher:async(_,init)=>{
  const request=JSON.parse(init.body);assert.equal(request.response_format.type,'json_object');assert.equal(request.model,'openai/gpt-oss-120b');
  assert.ok(init.signal);return Response.json({choices:[{message:{content:JSON.stringify({notes:[{source:'記録',note:'家庭で候補校を確認できたかを尋ねる。'}]})}}]});
 }});
 assert.equal(result[0].original,fields[0].value);
});
test('provider failures and invented sources are rejected without manufacturing notes',async()=>{
 await assert.rejects(cloudInterviewSummary(fields,{key:'fixture',fetcher:async()=>new Response('',{status:429})}),/429/);
 await assert.rejects(cloudInterviewSummary(fields,{key:'fixture',fetcher:async()=>Response.json({choices:[{message:{content:'{"notes":[{"source":"存在しない出典","note":"推測"}]}'}}]})}),/出典/);
});
