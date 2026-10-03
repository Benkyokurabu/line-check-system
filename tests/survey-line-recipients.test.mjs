import test from 'node:test';
import assert from 'node:assert/strict';
import {surveyLineRecipients} from '../src/lib/survey-line-recipients.mjs';
const id=n=>'U'+String(n).padStart(32,'0'),number='2019001';
const row=(n,relation='mother',status='unverified',student_number=number)=>({line_user_id:id(n),student_number,relation,verification_status:status,alias_name:'登録名',friend_display_name:'表示名'});
test('saved student-number links include ordinary unverified guardians and separate the student',()=>{
 const r=surveyLineRecipients(number,[row(1),row(2,'student'),row(3,'father','confirmed')],[],[{line_user_id:id(1),alias_name:'現在の母の登録名'}]);
 assert.equal(r.length,3);assert.deepEqual(r.map(a=>a.category),['guardian','guardian','student']);assert.equal(r.find(a=>a.id===id(1)).label,'母・現在の母の登録名');assert.equal(r.find(a=>a.id===id(1)).verification,'registered');assert.equal(r.find(a=>a.id===id(3)).verification,'confirmed');
});
test('other students, revoked/review links and invalid LINE IDs are never accepted for sending',()=>{
 const rows=[row(1,'mother','confirmed','2020002'),row(2,'mother','revoked'),row(3,'father','needs_review'),{...row(4),line_user_id:'test-user'}];
 assert.deepEqual(surveyLineRecipients(number,rows,[{student_number:number,line_user_id:id(2)}]),[]);
});
test('legacy student-number links remain visible with an explicit unknown relationship',()=>{
 const r=surveyLineRecipients(number,[],[{student_number:number,line_user_id:id(1)},{student_number:'other',line_user_id:id(2)}]);
 assert.equal(r.length,1);assert.equal(r[0].category,'unknown');assert.equal(r[0].relation,'unknown');assert.equal(r[0].studentNumber,number);
});
test('shared family accounts can link to siblings, but are returned once for this student',()=>{
 const r=surveyLineRecipients(number,[row(1,'shared'),row(1,'shared','unverified','2020002')],[{student_number:number,line_user_id:id(1)}]);
 assert.equal(r.length,1);assert.equal(r[0].category,'guardian');
});
