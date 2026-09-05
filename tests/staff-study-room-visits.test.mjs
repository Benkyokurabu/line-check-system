import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveStaffStudyRoomVisit} from '../src/lib/staff-study-room-visits.mjs';
const input={operationKey:'00000000-0000-0000-0000-000000000001',requestId:'00000000-0000-0000-0000-000000000002',expectedVersion:0,
  startedAt:'2030-01-01T14:55:00+09:00',endedAt:null,destination:null,reason:''};
test('visit API uses verified identity and rejects ambiguous timestamps before RPC',async()=>{
  const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});return {data:{saved:true}};}};
  const identity={authUserId:'verified-user',authSessionId:'verified-session'};
  await saveStaffStudyRoomVisit(client,identity,{...input,authUserId:'forged'});
  assert.equal(calls[0].args.p_auth_user_id,'verified-user');
  for(const change of [{startedAt:'2030-01-01T14:55'},{expectedVersion:-1},{destination:'automatic_home'},{reason:null},{operationKey:'bad'}]) {
    await assert.rejects(saveStaffStudyRoomVisit(client,identity,{...input,...change}),error=>error.status===400);
  }
  assert.equal(calls.length,1);
});
test('visit API distinguishes conflicts, permissions, invalid times and outages',async()=>{
  for(const [message,status] of [['version_conflict',409],['idempotency_conflict',409],['staff_permission_denied',403],['invalid_visit_time',400],['reason_required',400],['staff_session_expired',401],['workflow_disabled',503]]) {
    await assert.rejects(saveStaffStudyRoomVisit({rpc:async()=>({error:{message}})},{},input),error=>error.status===status);
  }
});
