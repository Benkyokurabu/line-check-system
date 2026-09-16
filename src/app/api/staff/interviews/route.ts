import { NextRequest } from 'next/server';
import {assertInterviewAccess} from '@/lib/interview-access.mjs';
import { createHash } from 'node:crypto';
import {syncInterview,bensukeRequest} from '@/lib/interview-sync';
import {BENSUKE_SOURCE,prepareBinding,checkedPage,scheduleValue,equivalentSchedule,teacherMatch,staffDirectory,checkNotionConflicts,desiredSchedule,scheduleProperties} from '@/lib/bensuke-booking.mjs';
import {bensukeReview} from '@/lib/bensuke-review';
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
  assertInterviewAccess(context.staff);
  return staffResponse(publicState(await loadInterviewState(context.dataClient),context.staff),context);
 }catch(error){return failure(error,context);}
}
export async function POST(request:NextRequest){
 let context;
 try{
  assertStaffMutationOrigin(request);context=await staffContext(request);
  assertInterviewAccess(context.staff);
  if(!['admin','office','employee'].includes(context.staff.role))throw new InterviewError('予定の登録・承認は事務部・正社員・管理者が行えます。',403);
  const body=await staffJsonBody(request,65536);
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
  const existing=state.bookings.find(r=>r.id===body.id);
  const review=body.adoptRemote===true?await bensukeReview(context.dataClient,String(body.id)):null;
  if(review&&(body.action!=='update'||!review.candidate||body.remoteEditedAt!==review.editedAt||!review.changed))throw new InterviewError(review.issue||'Notionの予定が更新されました。差分を再確認してください。',409);
  const data=validateSave(review?{...body,data:review.candidate}:body,state);
  if(body.action==='create'&&body.bensuke){
   const link=body.bensuke as {pageId:string;editedAt:string};
   data.bensuke=await prepareBinding({request:bensukeRequest,sourceId:BENSUKE_SOURCE,pageId:link.pageId,editedAt:link.editedAt,data});
  }else if(existing?.notion_original&&['update','confirm'].includes(String(body.action))){
   const pageId=String(existing.notion_page_id),schema=await bensukeRequest(`/data_sources/${BENSUKE_SOURCE}`);
   const page=await checkedPage(bensukeRequest,pageId,BENSUKE_SOURCE),remote=scheduleValue(page,schema);
   if(!equivalentSchedule(remote,review?.remote??existing.notion_baseline))throw new InterviewError('Notion側の予定が変わっています。差分を確認してください。',409);
   const teacher=teacherMatch(String(data.teacher),await staffDirectory(bensukeRequest,schema));
   if(existing.status==='pending'){
    await prepareBinding({request:bensukeRequest,sourceId:BENSUKE_SOURCE,pageId,editedAt:page.last_edited_time,data});
   }else{
    scheduleProperties(desiredSchedule({...existing,data},teacher.id),schema);
    await checkNotionConflicts({request:bensukeRequest,sourceId:BENSUKE_SOURCE,schema,data,teacherId:teacher.id,excludeId:pageId});
   }
  }
  const args={
   p_auth_user_id:context.identity.authUserId,p_auth_session_id:context.identity.authSessionId,
   p_operation_key:body.operationKey,p_snapshot:body.snapshot,p_action:body.action,p_id:body.id??null,
   p_version:body.version??0,p_data:data,p_reason:body.reason??'',p_request_hash:requestHash,
  };
  let result;
  if(review){
   const {p_action:ignored,...adoptArgs}=args;void ignored;
   result=await context.dataClient.rpc('interview_bensuke_adopt',{...adoptArgs,p_remote:review.remote,p_edited_at:review.editedAt});
  }else result=await context.dataClient.rpc('interview_save',args);
  if(result.error){
   const reason=result.error.message;
   if(reason==='reason_required')throw new InterviewError('変更・取消の理由を入力してください。');
   if(result.error.code==='23505')throw new InterviewError('このベンスケの枠は既に別の面談で使用しています。再取得してください。',409);
   if(reason==='notion_sync_unresolved'||reason==='notion_local_unsynced')throw new InterviewError('Notionの反映結果を先に確認してください。',409);
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
