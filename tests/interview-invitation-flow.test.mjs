import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blocksNewInvitation,currentInvitation,defaultInvitationTeacher,invitationProgress,surveyAnswerFields} from '../src/lib/interview-invitation-flow.mjs';
import {invitationStudents} from '../src/lib/interview-invitation-students.mjs';
const now=Date.parse('2026-09-23T12:00:00+09:00');
const base={id:'i',student_id:'a',status:'active',created_at:'2026-09-23',expires_at:'2026-09-24T12:00:00+09:00',notification_status:'sent',answerStatus:'unanswered'};
test('アンケート提出と打診・送信・確定の状態を混同しない',()=>{
 assert.equal(invitationProgress(undefined,now),'new');assert.equal(invitationProgress(base,now),'waiting');
 assert.equal(invitationProgress({...base,notification_status:'retry'},now),'delivery');
 assert.equal(invitationProgress({...base,answerStatus:'pending',notification_status:'retry'},now),'pending');
 assert.equal(invitationProgress({...base,expires_at:'2026-09-22'},now),'rearrange');
 assert.equal(invitationProgress({...base,answerStatus:'confirmed',expires_at:'2026-09-22'},now),'confirmed');
 assert.equal(invitationProgress({...base,status:'declined'},now),'rearrange');
 assert.equal(blocksNewInvitation(base,now),true);assert.equal(blocksNewInvitation({...base,status:'revoked'},now),false);
 assert.equal(blocksNewInvitation({...base,answerStatus:'pending',expires_at:'2026-09-22'},now),true);
 assert.equal(blocksNewInvitation({...base,expires_at:'2026-09-22'},now),false);
});
test('古い有効案内を新しい取消済み履歴で隠さない・別の生徒を混ぜない',()=>{
 const rows=[{...base,id:'revoked',status:'revoked',created_at:'2026-09-24'},base,{...base,id:'other',student_id:'b',created_at:'2026-09-25'}];
 assert.equal(currentInvitation(rows,'a').id,'i');assert.equal(currentInvitation(rows,'missing'),undefined);assert.equal(rows[0].id,'revoked');
});
test('ログイン職員の担当を初期選択し曖昧な氏名は推測しない',()=>{
 const students=[{teacher:'工藤'},{teacher:'金城'},{teacher:'髙山'}];
 assert.equal(defaultInvitationTeacher({displayName:'工藤 謙'},students),'工藤');
 assert.equal(defaultInvitationTeacher({displayName:'高山先生'},students),'髙山');
 assert.equal(defaultInvitationTeacher({displayName:'事務部'},students),'');
 assert.equal(defaultInvitationTeacher({displayName:'工藤 謙'},[{teacher:'工藤'},{teacher:'工藤謙'}]),'工藤謙');
});
test('アンケート回を固定IDで束ね、照合済み回答の原本と履歴を保持',()=>{
 const b={campaign_id:'2026-autumn',campaign_label:'2026年 秋のアンケート',student_number:'1',link_status:'linked'};
 const result=invitationStudents([{id:'a',student_number:'1',student_name:'見本',enrollment_status:'current_roster'}],[{...b,page_id:'old',answered_at:'2026-09-20',answer_fields:[{label:'相談',value:'古い回答'}]},{...b,page_id:'new',answered_at:'2026-09-23',notion_url:'https://www.notion.so/example',answer_fields:[]},{...b,page_id:'unknown',link_status:'needs_review',answered_at:'2026-09-24'}]);
 assert.equal(result.rounds[0].label,b.campaign_label);assert.equal(result.rounds[0].id,b.campaign_id);
 assert.deepEqual(result.students[0].surveys[0].responses.map(r=>r.id),['new','old']);
});
test('回答欄を文字列化し、関係DB・内部集計を本文に混ぜない',()=>{
 assert.deepEqual(surveyAnswerFields({相談:{type:'rich_text',rich_text:[{plain_text:'進路相談'}]},希望:{type:'multi_select',multi_select:[{name:'対面'},{name:'電話'}]},同意:{type:'checkbox',checkbox:false},担任:{type:'select',select:{name:'職員'}},内部:{type:'rollup',rollup:{string:'secret'}},関連:{type:'relation',relation:[{id:'secret'}]}}),[{label:'相談',value:'進路相談'},{label:'希望',value:'対面、電話'},{label:'同意',value:'いいえ'}]);
});
