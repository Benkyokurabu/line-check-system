import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffStudyRoomTrial} from '../src/lib/staff-study-room-trial.mjs';
import {getJapanDate} from '../src/lib/reservation-date.mjs';
const staff={role:'office',staffCode:'TEST',displayName:'確認担当'};
const get=(room,path)=>room.handle(`/api/staff/study-room/${path}`,undefined,staff);
const post=(room,path,body)=>room.handle(`/api/staff/study-room/${path}`,{method:'POST',body:JSON.stringify(body)},staff);
test('trial approves and cancels only trial rows, resetting restores fixture',()=>{
 const room=createStaffStudyRoomTrial();const row=get(room,`requests?date=${getJapanDate()}`).requests[0];
 const op={operationKey:'approve1',requestId:row.id,expectedVersion:1,action:'approve'};
 assert.equal(post(room,'transition',op).request.status,'approved');
 assert.equal(post(room,'transition',op).request.version,2);
 assert.throws(()=>post(room,'transition',{...op,action:'reject'}),{status:409});
 post(room,'transition',{operationKey:'cancel1',requestId:row.id,expectedVersion:2,action:'cancel'});
 assert.equal(get(room,`requests?date=${getJapanDate()}`).requests[0].status,'cancelled');
 room.reset();assert.equal(get(room,`requests?date=${getJapanDate()}`).requests[0].status,'pending');
});

test('shared snapshots retain requests, idempotency and visit history',()=>{
 let room=createStaffStudyRoomTrial(null,true);
 const op={operationKey:'shared',studentNumber:'TRIAL-KUDO',date:getJapanDate(),seat:2,slotIds:['16:45-18:15'],contactChannel:'other',note:'生徒役'};
 const row=post(room,'intake',op).request;
 room=createStaffStudyRoomTrial(room.snapshot(),true);
 assert.equal(post(room,'intake',op).request.id,row.id);
 assert.equal(room.snapshot().rows.length,1);
 post(room,'transition',{operationKey:'shared-approve',requestId:row.id,expectedVersion:1,action:'approve'});
 const visit={operationKey:'visit',requestId:row.id,expectedVersion:0,startedAt:new Date().toISOString(),endedAt:null,destination:null,reason:''};
 post(room,'visits',visit);
 room=createStaffStudyRoomTrial(room.snapshot(),true);
 assert.equal(get(room,`visit-history?request=${row.id}`).events.length,1);
 assert.throws(()=>post(room,'visits',{...visit,operationKey:'bad-visit',expectedVersion:1}),{status:400});
 assert.throws(()=>post(room,'visits',{...visit,operationKey:'bad-time',expectedVersion:1,reason:'訂正',startedAt:null,endedAt:new Date().toISOString()}),{status:400});
});
test('trial proxy intake searches fixtures and prevents double booking',()=>{
 const room=createStaffStudyRoomTrial();
 const opts=get(room,`intake-options?date=${getJapanDate()}&query=生徒B&student=TRIAL002`);
 assert.equal(opts.students.length,1);assert.equal(opts.student.student_number,'TRIAL002');
 const a=get(room,`requests?date=${getJapanDate()}`).requests[0];
 post(room,'transition',{operationKey:'a',requestId:a.id,expectedVersion:1,action:'approve'});
 const b=post(room,'intake',{operationKey:'b',studentNumber:'TRIAL002',date:getJapanDate(),seat:1,slotIds:['16:45-18:15'],contactChannel:'phone',note:'操作確認'}).request;
 assert.throws(()=>post(room,'transition',{operationKey:'c',requestId:b.id,expectedVersion:1,action:'approve'}),{status:409});
});
test('trial rejects unauthorized roles and has no production route fallback',()=>{
 const room=createStaffStudyRoomTrial();
 assert.throws(()=>room.handle('/api/staff/study-room/requests',undefined,{role:'teacher'}),{status:403});
 assert.throws(()=>room.handle('/api/admin/contacts',undefined,staff),{status:404});
});

test('trial rejects the unapproved 14:55 slot',()=>{const room=createStaffStudyRoomTrial(null,true);assert.throws(()=>post(room,'intake',{operationKey:'removed',studentNumber:'TRIAL-KUDO',date:getJapanDate(),seat:1,slotIds:['14:55-16:25'],contactChannel:'other',note:'確認'}),{status:400});});
