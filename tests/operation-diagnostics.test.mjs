import test from 'node:test';import assert from 'node:assert/strict';
import {checkedDiagnostic,diagnosticArea,diagnosticFacts,checkedAnalysis} from '../src/lib/operation-diagnostics.mjs';
import {operationSupportToken,verifyOperationSupportToken,operationSupportActor} from '../src/lib/operation-support-token.mjs';
const fixture={area:'attendance',method:'POST',symptom:'http',status:503,elapsedMs:12000,online:true};
test('only bounded diagnostic enums are accepted; no business data can enter the model request',()=>{
 assert.deepEqual(checkedDiagnostic(fixture),fixture);
 for(const extra of [{text:'private'},{url:'https://private.test/user'},{staffId:'private'},{headers:{}},{message:'private'}])assert.throws(()=>checkedDiagnostic({...fixture,...extra}));
 for(const patch of [{area:'__proto__'},{area:'PRIVATE'},{method:'CONNECT'},{status:200},{status:600},{elapsedMs:-1},{elapsedMs:Infinity},{elapsedMs:3600001},{online:'true'},{symptom:'raw'}])assert.throws(()=>checkedDiagnostic({...fixture,...patch}));
 for(const symptom of ['network','timeout','client']){assert.equal(checkedDiagnostic({...fixture,symptom,status:0}).status,0);assert.throws(()=>checkedDiagnostic({...fixture,symptom}));}
});
test('facts distinguish observations, read freshness and unknown write outcomes',()=>{
 const write=diagnosticFacts(fixture);assert.match(write.observation,/503/);assert.match(write.outcome,/判断できません/);assert.match(write.certainty,/確定.*ではありません/);
 const read=diagnosticFacts({...fixture,method:'GET'});assert.match(read.outcome,/最新とは限りません/);
 assert.match(diagnosticFacts({...fixture,method:'GET',symptom:'timeout',status:0}).observation,/制限時間/);
 assert.match(diagnosticFacts({...fixture,online:false}).observation,/オフライン/);
});
test('business areas are derived without retaining source URLs, names or IDs',()=>{
 for(const [path,area] of [['/api/attendance/candidates/private-id','attendance'],['/api/staff/interview-materials','materials'],['/api/staff/survey-workflow','interviews'],['/api/staff/journals','journals'],['/api/staff/benkei','benkei'],['/api/staff/school-context','context'],['/api/staff/visit-followup','enrollment'],['/api/students/private-person/messages','contacts'],['/api/schedule/calendar','schedule'],['/api/staff/study-room/visits','studyRoom']])assert.equal(diagnosticArea(path),area);
});
test('AI output is short plain text; invalid or absent output is not mislabeled as analysis',()=>{
 assert.deepEqual(checkedAnalysis({assessment:'応答を確認できません。原因は未確定です。',nextStep:'一覧で結果を確認してください。'}),{assessment:'応答を確認できません。原因は未確定です。',nextStep:'一覧で結果を確認してください。'});
 for(const v of [null,{}, {assessment:'',nextStep:'a'},{assessment:'a'.repeat(601),nextStep:'a'},{assessment:'<script>bad</script>',nextStep:'a'},{assessment:'a',nextStep:'https://outside.test'}])assert.throws(()=>checkedAnalysis(v));
});

test('model advice cannot discard inputs or encourage another write after an unknown outcome',()=>{
 for(const nextStep of ['ページを再読み込みして情報が更新されるか確認してください。','一覧で未反映なら再度実行してください。','再送信してください。','画面を更新してください。','もう一度保存してください。','Reload the page.','Retry the request.']){
  assert.throws(()=>checkedAnalysis({assessment:'原因は未確定です。',nextStep}),/invalid_analysis/);
 }
 assert.doesNotThrow(()=>checkedAnalysis({assessment:'接続先の応答が遅れている可能性があります。',nextStep:'入力を保ったまま履歴で結果を確認し、判断できなければ担当者に相談してください。'}));
});
const now=Date.parse('2026-10-23T09:00:00Z'),secret='isolated-support-secret',staff={staffId:'private-staff-id',expiresAt:new Date(now+3600000).toISOString()};
test('support tokens are scoped, signed, short-lived and contain no business identity',()=>{
 const token=operationSupportToken(staff,secret,now);assert.equal(token.maxAge,900);
 const actor=operationSupportActor(staff.staffId,secret);assert.deepEqual(verifyOperationSupportToken(token.value,secret,now),{actor});
 const payload=JSON.parse(Buffer.from(token.value.split('.')[0],'base64url'));assert.equal(payload.scope,'operation-analysis');assert(!JSON.stringify(payload).includes(staff.staffId));assert(!Object.hasOwn(payload,'role'));
 assert.equal(operationSupportToken(staff,secret,now+60000).value===token.value,false);assert.equal(verifyOperationSupportToken(operationSupportToken(staff,secret,now+60000).value,secret,now+60000).actor,actor);
});
test('token expiry never exceeds staff expiry; tampering, wrong keys and old tokens fail closed',()=>{
 const short=operationSupportToken({...staff,expiresAt:new Date(now+30000).toISOString()},secret,now);assert.equal(short.maxAge,30);
 assert.equal(verifyOperationSupportToken(short.value,secret,now+30000),null);
 const token=operationSupportToken(staff,secret,now);
 for(const value of [token.value+'x','not-a-token','a.b.c',token.value.replace(/^./,'x')])assert.equal(verifyOperationSupportToken(value,secret,now),null);
 assert.equal(verifyOperationSupportToken(token.value,'wrong-secret',now),null);assert.equal(verifyOperationSupportToken(token.value,secret,now+900000),null);assert.equal(verifyOperationSupportToken(token.value,secret,now-1000),null);
 for(const s of [null,{}, {...staff,expiresAt:'invalid'},{...staff,expiresAt:new Date(now).toISOString()}])assert.equal(operationSupportToken(s,secret,now),null);
 assert.equal(operationSupportToken(staff,'',now),null);
});
