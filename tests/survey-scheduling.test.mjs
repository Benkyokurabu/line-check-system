import {test} from 'node:test';import assert from 'node:assert/strict';import {surveyProgress as progress,surveyScheduling as status} from '../src/lib/survey-scheduling.mjs';
const now=Date.parse('2026-09-23T00:00:00Z');
const invitation={id:'i',student_id:'s',slots:[{surveyCampaign:{id:'2026-autumn'}}],created_at:'2026-09-20',status:'active',expires_at:'2026-10-01',notification_status:'sent'};
test('未連絡、返信待ち、承認待ち、確定日時を区別する',()=>{
 assert.equal(status('s',[],[],[],now).status,'uncontacted');assert.equal(status('s',[invitation],[],[],now).detail,'返信待ち');
 const request={invitation_id:'i',status:'pending',booking_id:'b'};assert.match(status('s',[invitation],[request],[],now).detail,/承認待ち/);
 assert.deepEqual(status('s',[invitation],[{...request,status:'approved'}],[{id:'b',status:'confirmed',data:{date:'2026-09-30',start:'16:00',end:'16:45'}}],now),{status:'confirmed',detail:'日程が確定しています。',date:'2026-09-30',start:'16:00',end:'16:45'});
});
test('送信失敗を打診済みとせず、期限切れ・取消・再調整を補足する',()=>{
 assert.equal(status('s',[{...invitation,notification_status:'retry'}],[],[],now).status,'uncontacted');
 assert.match(status('s',[{...invitation,expires_at:'2026-09-21'}],[],[],now).detail,/期限切れ/);
 assert.match(status('s',[{...invitation,status:'revoked'}],[],[],now).detail,/取消/);
 assert.match(status('s',[invitation],[{invitation_id:'i',status:'approved',booking_id:'b'}],[{id:'b',status:'cancelled'}],now).detail,/再調整/);
});
test('他生徒・別アンケートを混ぜず、紐づけ不明を未連絡にしない',()=>{
 assert.equal(status(null,[],[],[],now).status,'unknown');assert.equal(status('other',[invitation],[],[],now).status,'uncontacted');
 assert.equal(status('s',[{...invitation,slots:[{surveyCampaign:{id:'2026-spring'}}]}],[],[],now).status,'uncontacted');
 assert.equal(status('s',[{...invitation,slots:[]}],[],[],now).status,'unknown');
 assert.equal(status('s',[],[],[{data:{studentId:'s'},status:'confirmed'}],now).status,'unknown');
});
test('再打診中は最新の有効な打診を表示し、確定済みは維持する',()=>{
 const newer={...invitation,id:'new',created_at:'2026-09-22',notification_status:'retry'};
 assert.equal(status('s',[invitation,newer],[],[],now).status,'uncontacted');
 assert.equal(status('s',[invitation,newer],[{invitation_id:'i',booking_id:'b'}],[{id:'b',status:'completed',data:{date:'2026-09-21'}}],now).status,'completed');
});
test('手動確認と面談記録を一つの業務進捗にまとめる',()=>{
 assert.equal(progress(false,{status:'uncontacted'}).status,'needs-review');
 assert.equal(progress(true,{status:'uncontacted'}).status,'handled');
 assert.equal(progress(true,{status:'invited'}).status,'coordinating');
 assert.equal(progress(false,{status:'confirmed'}).status,'scheduled');
 assert.equal(progress(false,{status:'completed'}).status,'completed');
 assert.equal(progress(true,{status:'unknown'}).status,'handled');
 assert.equal(progress(false,{status:'uncontacted'},'coordinating').status,'coordinating');
 assert.equal(progress(true,{status:'completed'},'scheduled').status,'scheduled');
});
