import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loginStaffEntry,staffEntryDestination} from '../src/lib/staff-entry.mjs';
const user='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
const key='x'.repeat(43),token=`h.${Buffer.from(JSON.stringify({sub:user,session_id:sid})).toString('base64url')}.s`;
function clients(code='KUDO'){
 const calls=[];
 const identityClient={auth:{admin:{generateLink:async input=>{calls.push(['generate',input]);return {data:{user:{id:user},properties:{hashed_token:'otp'}}};}},verifyOtp:async input=>{calls.push(['verify',input]);return {data:{user:{id:user},session:{access_token:token,refresh_token:'refresh'}}};},getUser:async()=>({data:{user:{id:user}}})}};
 const dataClient={rpc:async(name,args)=>{calls.push([name,args]);return name==='staff_entry_target'?{data:{staffCode:code,email:'test@example.invalid',authUserId:user}}:{data:{staffCode:code,staffId:'staff',expiresAt:'2099-01-01T00:00:00Z'}};}};
 return {identityClient,dataClient,calls};
}
test('専用キーをハッシュ照合し、管理認証の確認済みセッションだけを初期化する',async()=>{
 for(const code of ['KUDO','KINJO']){
  const c=clients(code),result=await loginStaffEntry({...c,key});assert.equal(result.staff.staffCode,code);
  assert.deepEqual(c.calls[0],['staff_entry_target',{p_key_hash:createHash('sha256').update(key).digest('hex')}]);
  assert.equal(c.calls.at(-1)[0],'staff_authorize');assert.equal(c.calls.at(-1)[1].p_initialize,true);
  assert.ok(!JSON.stringify(c.calls).includes(key));
 }
});
test('コードだけ・不正キー・無効キー・他職員・取得障害・制限中はログインさせない',async()=>{
 for(const key of ['KUDO','KINJO','',null])await assert.rejects(()=>loginStaffEntry({...clients(),key}),/invalid_credentials/);
 await assert.rejects(()=>loginStaffEntry({...clients('OTHER'),key}),/invalid_credentials/);
 for(const response of [{data:null},{error:{}},{data:{limited:true}}]){
  const c=clients();c.dataClient.rpc=async()=>response;await assert.rejects(()=>loginStaffEntry({...c,key}));assert.equal(c.calls.length,0);
 }
});
test('生成先ユーザーの不一致と偽装セッションを拒否する',async()=>{
 const c=clients();c.identityClient.auth.admin.generateLink=async()=>({data:{user:{id:'other'},properties:{hashed_token:'otp'}}});
 await assert.rejects(()=>loginStaffEntry({...c,key}),/auth_unavailable/);
 const d=clients();d.identityClient.auth.getUser=async()=>({data:{user:{id:'other'}}});await assert.rejects(()=>loginStaffEntry({...d,key}),/invalid_session/);
});
test('戻り先は固定の内部ページだけ、職員コードは認証結果で決める',()=>{
 assert.equal(staffEntryDestination('//evil.invalid','KUDO'),'/staff/interviews?staff=KUDO');
 assert.equal(staffEntryDestination('study','KINJO'),'/self-study-room/trial?staff=KINJO');
 assert.equal(staffEntryDestination('interviewTrial','KUDO'),'/reservations/trial?staff=KUDO&kind=interview');
});
