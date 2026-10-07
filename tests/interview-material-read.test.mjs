import {test} from 'node:test';
import assert from 'node:assert/strict';
import {materialReadRequest} from '../src/lib/interview-material-read.mjs';
test('shared source reads deduplicate in-flight schema and staff reads but keep each day query distinct',async()=>{
 const calls=[];const read=materialReadRequest(async(path,init)=>{calls.push([path,init.body]);return {path};},AbortSignal.timeout(1000));
 await Promise.all([read('/schema'),read('/schema'),read('/staff/query',{method:'POST',body:'same'}),read('/staff/query',{method:'POST',body:'same'})]);
 await read('/schedule/query',{method:'POST',body:'day1'});await read('/schedule/query',{method:'POST',body:'day2'});
 assert.equal(calls.length,4);
 await assert.rejects(async()=>read('/pages/id',{method:'PATCH'}),/cannot mutate/);
});
test('rate limits and temporary faults retry within the request, respecting Retry-After',async()=>{
 let calls=0;const waits=[];
 const read=materialReadRequest(async()=>{calls++;if(calls===1)throw Object.assign(Error('rate'),{status:429,retryAfterMs:3000});if(calls===2)throw TypeError('network');return 'success';},AbortSignal.timeout(1000),async ms=>waits.push(ms));
 assert.equal(await read('/schema'),'success');assert.equal(calls,3);assert.deepEqual(waits,[3000,2000]);
});
test('permanent errors, exhausted retries and aborted requests stop without pretending to have complete data',async()=>{
 for(const status of [401,403,429,503]){let calls=0;const read=materialReadRequest(async()=>{calls++;throw Object.assign(Error('failure'),{status});},AbortSignal.timeout(1000),async()=>{});await assert.rejects(read('/schema'));assert.equal(calls,status<429?1:3);}
 const controller=new AbortController();controller.abort();let called=false;const read=materialReadRequest(async()=>{called=true;},controller.signal);await assert.rejects(read('/schema'));assert.equal(called,false);
});
