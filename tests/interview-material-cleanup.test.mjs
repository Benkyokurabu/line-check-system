import {test} from 'node:test';
import assert from 'node:assert/strict';
import {removeMaterialJobFiles} from '../src/lib/interview-material-cleanup.mjs';
test('expired job cleanup removes legacy and lease-scoped PDFs including stale attempts',async()=>{
 const removed=[]; const folders={'jobs/job':[{id:'old',name:'bundle.pdf'},{id:null,name:'lease-a'},{id:null,name:'lease-b'}],
 'jobs/job/lease-a':[{id:'a',name:'bundle.pdf'}],'jobs/job/lease-b':[{id:'b',name:'material-0.pdf'}]};
 await removeMaterialJobFiles({list:async(p)=>({data:folders[p],error:null}),remove:async(paths)=>{removed.push(...paths);return {error:null};}},'job');
 assert.deepEqual(removed,['jobs/job/bundle.pdf','jobs/job/lease-a/bundle.pdf','jobs/job/lease-b/material-0.pdf']);
});
test('listing and removal errors are propagated so the job can remain for retry',async()=>{
 await assert.rejects(removeMaterialJobFiles({list:async()=>({error:Error('list failed')})},'job'),/list failed/);
 await assert.rejects(removeMaterialJobFiles({list:async()=>({data:[{id:'file',name:'bundle.pdf'}]}),remove:async()=>({error:Error('remove failed')})},'job'),/remove failed/);
});
