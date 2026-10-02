import test from 'node:test';
import assert from 'node:assert/strict';
import {validInterviewDate,notionRecordText,interviewLineRetryKey,interviewDateParts,recordBlockState,RECORD_CAPTION} from '../src/lib/survey-workflow-core.mjs';

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

test('appointment time is displayed on the correct Japanese calendar day',()=>{
 assert.deepEqual(interviewDateParts('2026-10-01T15:30:00Z'),{date:'2026-10-02',time:'00:30'});
 assert.deepEqual(interviewDateParts('2026-10-02'),{date:'2026-10-02',time:''});
 assert.deepEqual(interviewDateParts('invalid'),{date:'',time:''});
});
test('existing multi-block records allow an owned addition without replacing originals',()=>{
 const original={id:'original',type:'paragraph',paragraph:{rich_text:[{plain_text:'元の記録'}]}};
 const owned={id:'owned',type:'code',last_edited_time:'version',code:{caption:[{plain_text:RECORD_CAPTION}],rich_text:[{plain_text:'追記'}]}};
 assert.deepEqual(recordBlockState({results:[original]},'page-version'),{editable:true,body:'',blockId:'',blockEditedAt:'page-version',existingText:'元の記録'});
 assert.deepEqual(recordBlockState({results:[original,owned]}),{editable:true,body:'追記',blockId:'owned',blockEditedAt:'version',existingText:'元の記録'});
 assert.equal(recordBlockState({results:[original,owned,{...owned,id:'other'}]}).editable,false);
 assert.equal(recordBlockState({results:[original],has_more:true}).editable,false);
 assert.equal(recordBlockState({results:[{...owned,has_children:true}]}).editable,false);
});
