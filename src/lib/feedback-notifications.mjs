// Recipient and message are obtained only from the private database claim.
/** @param {{db:import('@supabase/supabase-js').SupabaseClient,token?:string,feedbackId?:string|null,limit?:number,request?:typeof fetch}} options */
export async function sendFeedbackNotifications({db,token,feedbackId=null,limit=5,request=fetch}){
 const results=[];
 if(!token)return {processed:0,status:'unavailable'};
 for(let i=0;i<Math.min(Math.max(limit,1),5);i++){
  const claim=await db.rpc('feedback_notification_claim',{p_feedback:feedbackId});
  if(claim.error)return {processed:results.length,status:'retry'};
  const n=claim.data;if(!n)break;
  let status='retry',requestId=null,error=null;
  try{
   if(!/^U[0-9a-f]{32}$/.test(n.recipient)||!n.message?.startsWith('【勉たん】改善のご意見が届きました。'))throw Error('invalid_notification');
   const response=await request('https://api.line.me/v2/bot/message/push',{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Line-Retry-Key':n.retry_key},
    body:JSON.stringify({to:n.recipient,messages:[{type:'text',text:n.message}]}),signal:AbortSignal.timeout(8000),
   });
   requestId=response.headers.get('x-line-accepted-request-id')??response.headers.get('x-line-request-id');
   if(response.ok||(response.status===409&&response.headers.get('x-line-accepted-request-id')))status='sent';
   else {status=response.status>=500||response.status===429?'retry':'blocked';error=`LINE HTTP ${response.status}`;}
  }catch{error='LINE応答を確認できません。同じ通知番号で再試行します。';}
  const done=await db.rpc('feedback_notification_finish',{p_feedback:n.feedback_id,p_lease:n.lease,p_result:status,p_request_id:requestId,p_error:error});
  if(done.error||done.data!==true)return {processed:results.length,status:'retry'};
  results.push(status);
  if(feedbackId)break;
 }
 return {processed:results.length,sent:results.filter(s=>s==='sent').length,status:results.includes('retry')?'retry':'ok'};
}
