import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import {syncInterview} from '@/lib/interview-sync';
import { staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';
import { loadInterviewState,publicState,validateSave } from '@/lib/interview-store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
function failure(error:unknown,context?:Awaited<ReturnType<typeof staffContext>>){
 if(error instanceof InterviewError)return staffResponse({error:error.message},context,error.status);
 return staffErrorResponse(error,context);
}
export async function GET(request:NextRequest){
 let context;
 try{
  context=await staffContext(request);
  return staffResponse(publicState(await loadInterviewState(context.dataClient),context.staff),context);
 }catch(error){return failure(error,context);}
}
export async function POST(request:NextRequest){
 let context;
 try{
  assertStaffMutationOrigin(request);context=await staffContext(request);
  if(!['admin','office','employee'].includes(context.staff.role))throw new InterviewError('予定の登録・承認は事務部・正社員・管理者が行えます。',403);
  const body=await staffJsonBody(request);
  const requestHash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  // Return the committed result after a lost response, even if the snapshot advanced.
  const {data:prior,error:priorError}=await context.dataClient.from('interview_events').select('actor,request,request_hash,after_value').eq('operation_key',body.operationKey).maybeSingle();
  if(priorError)throw new InterviewError('操作番号を確認してください。');
  if(prior){
   if(prior.actor!==context.staff.staffId||prior.request_hash!==requestHash)throw new InterviewError('操作番号が重複しています。',409);
   const req=prior.request;
   if(req.action!==body.action||req.id!==(body.id??null)||req.version!==(body.version??0)||req.reason!==(body.reason??''))throw new InterviewError('操作番号が重複しています。',409);
   return staffResponse({saved:prior.after_value,replayed:true},context);
  }
  const state=await loadInterviewState(context.dataClient);
  const data=validateSave(body,state);
  const result=await context.dataClient.rpc('interview_save',{
   p_auth_user_id:context.identity.authUserId,p_auth_session_id:context.identity.authSessionId,
   p_operation_key:body.operationKey,p_snapshot:body.snapshot,p_action:body.action,p_id:body.id??null,
   p_version:body.version??0,p_data:data,p_reason:body.reason??'',p_request_hash:requestHash,
  });
  if(result.error){
   const reason=result.error.message;
   if(reason==='reason_required')throw new InterviewError('変更・取消の理由を入力してください。');
   if(['version_conflict','invalid_state_transition','idempotency_conflict'].includes(reason))throw new InterviewError('予定が更新されました。再読込して確認してください。',409);
   throw new InterviewError('面談を保存できませんでした。再試行してください。',503);
  }
  let sync;
  if(result.data?.id&&result.data.status!=='pending'){
   try{sync=await syncInterview(context.dataClient,result.data.id);}
   catch{sync={status:'error',message:'面談は保存しました。Notion反映の結果は「Notionへ反映」から確認してください。'};}
  }
  return staffResponse({saved:result.data,sync},context);
 }catch(error){return failure(error,context);}
}
