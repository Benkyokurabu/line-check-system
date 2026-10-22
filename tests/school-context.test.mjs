import {test} from 'node:test';import assert from 'node:assert/strict';
import {assertSchoolContext,notionRecord,lineRecord,importedLineRecord,proposalForRecord} from '../src/lib/school-context-core.mjs';
const page={id:'source-page',last_edited_time:new Date().toISOString(),properties:{名前:{type:'title',title:[{plain_text:'面談'}]},生徒:{type:'relation',relation:[{id:'related-page'}]}}};
test('Notion原文と関連の根拠を保持し、氏名やrelationを生徒確定と扱わない',()=>{
 const record=notionRecord(page,[{id:'b',type:'paragraph',paragraph:{rich_text:[{plain_text:'確認してください'}]}}]);
 assert.match(record.text,/確認してください/);assert.equal(record.raw.page,page);assert.equal(record.associations[0].verifiedStudent,false);
 assert.ok(proposalForRecord(record));assert.notEqual(record.version,notionRecord(page,record.raw.blocks,{complete:false}).version);
 assert.equal(proposalForRecord(notionRecord({...page,archived:true},record.raw.blocks)),null);
});
test('LINE両方向を保存し、確認済み紐づけだけ生徒検索へ使う。未返信を断定しない',()=>{
 const row={id:'1',line_user_id:'U1',text:'面談を相談したい',direction:'inbound',created_at:new Date().toISOString()};
 const links=[{line_user_id:'U1',student_number:'123',verification_status:'unverified'},{line_user_id:'U1',student_number:'456',verification_status:'confirmed'}];
 const record=lineRecord(row,links);assert.deepEqual(record.associations.map(a=>a.id),['456']);assert.equal(record.coverage.complete,false);
 assert.match(proposalForRecord(record).description,/未対応・未返信とは判定していません/);
 assert.equal(proposalForRecord(lineRecord({...row,direction:'outbound'},links)),null);
 assert.notEqual(record.version,lineRecord(row,[]).version);
});
test('LINE履歴取込は方向・安定sourceKeyを必須にし網羅済みとしない',()=>{
 assert.throws(()=>importedLineRecord({content:'本文'}),/invalid/);
 const event={sourceKey:'line_manager:account:msg',nativeId:'msg',content:'相談があります',direction:'inbound',occurredAt:new Date().toISOString(),coverage:{complete:true}};
 const record=importedLineRecord(event);assert.equal(record.coverage.complete,false);assert.deepEqual(record.associations,[]);assert.equal(record.raw,event);
 const proposal=proposalForRecord(record);assert.equal(proposal.fingerprint,proposalForRecord({...record,version:'updated',text:'面談を相談'}).fingerprint);
 assert.equal(proposalForRecord({...record,occurredAt:'2000-01-01T00:00:00Z'}),null);assert.equal(proposalForRecord({...record,occurredAt:null}),null);
});
test('全職員へ公開せずKUDO個人アカウントを要求',()=>{
 assert.doesNotThrow(()=>assertSchoolContext({staffId:'id',staffCode:'KUDO',role:'admin'}));
 for(const staff of [null,{staffId:'id',staffCode:'KINJO',role:'admin'},{staffId:'id',staffCode:'KUDO',role:'teacher'}])assert.throws(()=>assertSchoolContext(staff),/permission_denied/);
});
