import test from 'node:test';
import assert from 'node:assert/strict';
import {validInterviewDate,notionRecordText,interviewLineRetryKey} from '../src/lib/survey-workflow-core.mjs';

test('dates reject invalid calendar days before changing Notion',()=>{
 assert.equal(validInterviewDate('2026-10-01'),true);
 assert.equal(validInterviewDate('2026-02-30'),false);
 assert.equal(validInterviewDate('2026/10/01'),false);
});

test('long Japanese record bodies stay within Notion text-item limits',()=>{
 const body='大宮（普通科）📘'.repeat(1500);
 const pieces=notionRecordText(body);
 assert.equal(pieces.map(x=>x.text.content).join(''),body);
 assert.ok(pieces.every(x=>x.text.content.length<=2000));
});

test('repeated LINE sends to one recipient use the same retry key, while distinct sends do not',()=>{
 const base=['survey-page','summary','line-mother','面談のまとめ'];
 const first=interviewLineRetryKey(...base);
 assert.match(first,/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/);
 assert.equal(interviewLineRetryKey(...base),first);
 assert.notEqual(interviewLineRetryKey('survey-page','summary','line-father','面談のまとめ'),first);
 assert.notEqual(interviewLineRetryKey('survey-page','schedule','line-mother','面談のまとめ'),first);
 assert.notEqual(interviewLineRetryKey('survey-page','summary','line-mother','別の文面'),first);
});
