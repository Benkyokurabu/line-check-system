// The database claim only yields the pinned KUDO pilot recipient. No recipient
// or message from an HTTP request is accepted here.
/** @param {{db: import('@supabase/supabase-js').SupabaseClient, bookingId?: string, invitationId?: string, staffCode: string, token?: string, request?: typeof fetch}} options */
export async function sendPilotNotification({db,bookingId=undefined,invitationId=undefined,staffCode,token,request=fetch}){
 if(staffCode!=='KUDO')return {status:'not_applicable'};
 const invitation=!!invitationId,kind=invitation?'interview_invitation_notification':'interview_pilot_notification',args=invitation?{p_invitation:invitationId}:{p_booking:bookingId};
 const claimed=await db.rpc(kind+'_claim',args);
 if(claimed.error)return {status:'retry',message:'予約は確定済みです。工藤検証LINE通知の状態を再確認してください。'};
 const n=claimed.data;
 if(!n){
  const state=await db.from(invitation?'interview_invitations':'interview_pilot_notifications').select(invitation?'notification_status':'status').eq(invitation?'id':'booking_id',invitationId??bookingId).maybeSingle();
  return {status:state.error?'retry':(invitation?state.data?.notification_status:state.data?.status)??'not_applicable'};
 }
 let result='retry',requestId=null,error=null;
 try{
  if(!token||!/^U[0-9a-f]{32}$/.test(n.recipient)||!n.message.startsWith('【工藤専用・動作確認】'))throw Error('pilot_send_unavailable');
  const response=await request('https://api.line.me/v2/bot/message/push',{
   method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Line-Retry-Key':n.retry_key},
   body:JSON.stringify({to:n.recipient,messages:[{type:'text',text:n.message}]}),signal:AbortSignal.timeout(8000),
  });
  requestId=response.headers.get('x-line-accepted-request-id')??response.headers.get('x-line-request-id');
  if(response.ok||(response.status===409&&response.headers.get('x-line-accepted-request-id')))result='sent';
  else {result=response.status>=500||response.status===429?'retry':'blocked';error=`LINE HTTP ${response.status}`;}
 }catch{error='LINE応答を確認できません。同じ通知番号で再確認します。';}
 const finished=await db.rpc(kind+'_finish',{...args,p_lease:n.lease,p_result:result,p_request_id:requestId,p_error:error});
 if(finished.error||finished.data!==true)return {status:'retry',message:'通知結果の保存を確認できません。同じ通知番号で再確認してください。'};
 return {status:result,message:result==='sent'?`工藤の検証用LINEへ${invitation?'案内':'確定通知'}を送信しました。`:'保存済みです。工藤検証LINE通知の状態を再確認してください。'};
}
