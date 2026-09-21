import {NextRequest} from 'next/server';
import {createHash} from 'node:crypto';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {assertInterviewAccess} from '@/lib/interview-access.mjs';
import {InterviewError} from '@/lib/interview-core.mjs';
import {loadInterviewState,readAll,validateSave} from '@/lib/interview-store';
import {bindingForSlot,publishData,notionOffers,available,type Slot} from '@/lib/interview-requests';
import {requestDbError} from '@/lib/parent-interview-http';
import {syncInterview} from '@/lib/interview-sync';
import {loginConfig} from '@/lib/parent-line-login.mjs';
import {sendPilotNotification} from '@/lib/interview-pilot-notification.mjs';
export const dynamic='force-dynamic';export const maxDuration=60;
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function GET(request:NextRequest){
 let context;try{
  context=await staffContext(request);assertInterviewAccess(context.staff);
  if(!['admin','office','employee'].includes(context.staff.role))throw new InterviewError('面談の受付管理権限がありません。',403);
  if(request.nextUrl.searchParams.get('offers')==='1')return staffResponse({offers:await notionOffers()},context);
  const state=await loadInterviewState(context.dataClient),slots=await readAll(context.dataClient,'interview_public_slots') as Slot[];
  const requests=await context.dataClient.from('interview_parent_requests').select('*').order('created_at',{ascending:false}).limit(500);
  if(requests.error)throw new InterviewError('申請を読み込めませんでした。',503);
  return staffResponse({snapshot:state.snapshot,slots,bookings:state.bookings,loginReady:!!loginConfig(),requests:requests.data.map(r=>({...r,line_user_id:undefined,studentName:state.students.find(s=>s.id===r.student_id)?.student_name??'台帳を確認してください',choices:r.choices.map((choice:{slotId:string;version:number;data:Record<string,string>})=>{const slot=slots.find(s=>s.id===choice.slotId),student=state.students.find(s=>s.id===r.student_id);return {...choice,available:!!student&&!!slot&&slot.version===choice.version&&available(slot,state,student.homeroom_teacher)};})}))},context);
 }catch(e){return e instanceof InterviewError?staffResponse({error:e.message},context,e.status):staffErrorResponse(e,context);}
}
export async function POST(request:NextRequest){
 let context;try{
  assertStaffMutationOrigin(request);context=await staffContext(request);assertInterviewAccess(context.staff);
  if(!['admin','office','employee'].includes(context.staff.role))throw new InterviewError('面談の受付管理権限がありません。',403);
  const body=await staffJsonBody(request);if(!uuid(body.operationKey))throw new InterviewError('操作をやり直してください。');
  const db=context.dataClient,identity={p_user:context.identity.authUserId,p_session:context.identity.authSessionId,p_operation:body.operationKey};
  if(body.action==='publish'||body.action==='unpublish'){
   if(!uuid(body.pageId))throw new InterviewError('日程を選んでください。');
   const published=body.action==='publish';
   const prior=await db.from('interview_request_events').select('actor,action,payload,result').eq('operation_key',body.operationKey).maybeSingle();
   if(prior.error)throw new InterviewError('結果を確認できません。',503);
   if(prior.data){if(prior.data.actor!=='staff:'+context.staff.staffId||prior.data.action!=='publish'||prior.data.payload.page!==body.pageId||prior.data.payload.published!==published)throw new InterviewError('操作番号が重複しています。',409);return staffResponse({saved:prior.data.result},context);}
   const value=published?await publishData(String(body.pageId),await loadInterviewState(db)):null;
   const saved=await db.rpc('interview_publish_slot',{...identity,p_page:body.pageId,p_data:value?.data??{},p_edited:value?.editedAt??'',p_published:published});requestDbError(saved.error);return staffResponse({saved:saved.data},context);
  }
  if(!['approve','reject'].includes(String(body.action))||!uuid(body.id)||!Number.isInteger(body.version)||body.action==='approve'&&!uuid(body.slotId))throw new InterviewError('申請と日程を選んでください。');
  const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const prior=await db.from('interview_request_events').select('actor,payload,result').eq('operation_key',body.operationKey).maybeSingle();if(prior.error)throw new InterviewError('結果を確認できません。',503);
  let result;
  if(prior.data){if(prior.data.actor!=='staff:'+context.staff.staffId||prior.data.payload.hash!==hash)throw new InterviewError('操作番号が重複しています。',409);result=prior.data.result;}
  else{
   const state=await loadInterviewState(db);let data={};
   if(body.action==='approve'){
    const requestRow=await db.from('interview_parent_requests').select('*').eq('id',body.id).single();
    if(requestRow.error||requestRow.data.status!=='pending'||requestRow.data.version!==body.version)throw new InterviewError('申請が更新されています。',409);
    const student=state.students.find(s=>s.id===requestRow.data.student_id),slot=(await readAll(db,'interview_public_slots') as Slot[]).find(s=>s.id===body.slotId);
    if(!student||!slot)throw new InterviewError('日程または生徒情報を確認してください。',409);
    data=await bindingForSlot(slot,student,state,requestRow.data.note);
    validateSave({operationKey:body.operationKey,snapshot:state.snapshot,action:'create',data,manualReviewed:true,externalReviewed:true},state);
   }
   const saved=await db.rpc('interview_review_request',{...identity,p_id:body.id,p_version:body.version,p_action:body.action,p_slot:body.slotId??null,p_snapshot:state.snapshot,p_data:data,p_reason:typeof body.reason==='string'?body.reason:'',p_hash:hash});requestDbError(saved.error);result=saved.data;
  }
  let sync;if(result.booking_id){try{sync=await syncInterview(db,result.booking_id);}catch{sync={status:'error',message:'承認済みです。Notion反映は再確認してください。'};}}
  const notification=result.booking_id?await sendPilotNotification({db,bookingId:result.booking_id,staffCode:context.staff.staffCode,token:process.env.LINE_CHANNEL_ACCESS_TOKEN}):undefined;
  return staffResponse({saved:result,sync,notification},context);
 }catch(e){return e instanceof InterviewError?staffResponse({error:e.message},context,e.status):staffErrorResponse(e,context);}
}
