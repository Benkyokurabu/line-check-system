import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parentSummary} from '../src/lib/parent-interview-summary.mjs';
const pilot='BENTAN-KUDO-INTERVIEW-LIVE-PREVIEW';
function fixture({linked=true,retired=false,fail=''}={}){
 const data={student_line_accounts:[{line_user_id:pilot,student_number:'one',verification_status:linked?'confirmed':'revoked',relation:'student'},{line_user_id:'other',student_number:'two',verification_status:'confirmed',relation:'mother'}],
 student_registry:[{student_number:'one',interview_student_id:'s1',student_name:'本人',homeroom_teacher:'工藤先生',enrollment_status:'current_roster'},{student_number:'two',interview_student_id:'s2',student_name:'別人',enrollment_status:'current_roster'}],
 interview_students:[{id:'s1',retired_at:retired?'2026-01-01':null},{id:'s2',retired_at:null}],
 interview_parent_requests:[{id:'q1',invitation_id:'i1',student_id:'s1',booking_id:'b1',status:'approved',choices:[],note:'',reason:'',version:2,line_user_id:'secret'},{id:'q2',student_id:'s2',booking_id:'b2',status:'approved',choices:[],note:'PRIVATE'}],
 interview_bookings:[{id:'b1',student_id:'s1',status:'confirmed',data:{date:'2030-01-03',start:'13:00',end:'13:45',internalMemo:'secret'}},{id:'b2',student_id:'s2',status:'confirmed',data:{date:'2030-01-04'}}],
 interview_invitations:[{id:'i1',student_id:'s1',version:1,status:'active',expires_at:'2099-01-01',recipient:'secret'}]};
 const calls=[];const db={from(table){const call={table,filters:[]};calls.push(call);let rows=[...data[table]];const q={select(fields){call.fields=fields;return q},eq(k,v){call.filters.push([k,v]);rows=rows.filter(r=>r[k]===v);return q},in(k,v){call.filters.push([k,v]);rows=rows.filter(r=>v.includes(r[k]));return q},is(k,v){rows=rows.filter(r=>r[k]===v);return q},gt(k,v){rows=rows.filter(r=>r[k]>v);return q},maybeSingle(){return Promise.resolve({data:rows[0]??null,error:null})},order(){return q},limit(n){rows=rows.slice(0,n);return q},then(resolve,reject){return Promise.resolve({data:rows,error:table===fail?{message:'failed'}:null}).then(resolve,reject)}};return q}};return {db,calls};
}
test('初回は本人の予約を限定取得し、Notion・全校の予定を読まず安全な表示項目だけ返す',async()=>{
 const {db,calls}=fixture(),state=await parentSummary(db,pilot);
 assert.equal(state.students.length,1);assert.equal(state.students[0].name,'本人');assert.equal(state.requests.length,1);assert.equal(state.requests[0].confirmed.status,'confirmed');assert.equal(state.slotsPending,true);assert.deepEqual(state.slots,[]);
 assert.ok(!JSON.stringify(state).includes('secret'));assert.ok(!JSON.stringify(state).includes('別人'));assert.ok(!JSON.stringify(state).includes('PRIVATE'));
 assert.deepEqual(calls.find(c=>c.table==='interview_bookings').filters,[['id',['b1']],['student_id',['s1']]]);
 assert.ok(calls.every(c=>!['lessons','interview_public_slots','interview_settings'].includes(c.table)));
});
test('未確認の紐付け・引退済みIDは表示せず、取得失敗を空予約にしない',async()=>{
 let f=fixture({linked:false});assert.deepEqual((await parentSummary(f.db,pilot)).students,[]);assert.equal(f.calls.length,1);
 f=fixture({retired:true});const result=await parentSummary(f.db,pilot);assert.deepEqual(result.requests,[]);assert.equal(result.slotsPending,false);assert.ok(!f.calls.some(c=>c.table==='interview_bookings'));
 f=fixture({fail:'interview_bookings'});await assert.rejects(()=>parentSummary(f.db,pilot),/確定日時を読み込めません/);
});
test('一般保護者には工藤の案内を返さない',async()=>{
 const {db,calls}=fixture(),result=await parentSummary(db,'other');assert.equal(result.students[0].name,'別人');assert.equal(result.slotsPending,false);assert.deepEqual(result.invitations,[]);assert.ok(!calls.some(c=>c.table==='interview_invitations'));
});
test('リンク先の案内は本人の生徒だけに限定し、他の案内IDを拒否する',async()=>{
 let f=fixture();const result=await parentSummary(f.db,pilot,'i1');assert.equal(result.requests.length,1);assert.equal(result.invitations[0].id,'i1');
 f=fixture();await assert.rejects(()=>parentSummary(f.db,pilot,'other-invitation'),/この案内は開けません/);
 f=fixture();await assert.rejects(()=>parentSummary(f.db,'other','i1'),/この案内は開けません/);
});
