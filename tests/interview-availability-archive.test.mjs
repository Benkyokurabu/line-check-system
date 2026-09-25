import {test} from 'node:test';
import assert from 'node:assert/strict';
import {archiveBlockReason} from '../src/lib/interview-availability-archive.mjs';

const pageId='00000000-0000-4000-8000-000000000011',slot={id:'slot',notion_page_id:pageId};
const base={pageId,slot,bookings:[],requests:[],invitations:[]};
test('予約履歴・申請・案内が残るNotion予約可を削除させない',()=>{
 assert.match(archiveBlockReason({...base,bookings:[{notion_page_id:pageId,status:'cancelled'}]}),/予約履歴/);
 assert.match(archiveBlockReason({...base,requests:[{status:'pending',choices:[{slotId:'slot'}]}]}),/申請中/);
 assert.match(archiveBlockReason({...base,invitations:[{status:'active',slots:[{id:'slot'}]}]}),/打診中/);
 assert.equal(archiveBlockReason({...base,requests:[{status:'rejected',choices:[{slotId:'slot'}]}],invitations:[{status:'revoked',slots:[{id:'slot'}]}]}),'');
});
