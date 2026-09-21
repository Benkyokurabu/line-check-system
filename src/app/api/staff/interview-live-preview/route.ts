import {createHash,randomBytes} from 'node:crypto';
import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {InterviewError} from '@/lib/interview-core.mjs';
import {parentView,parentRequest,validateRequestedSlots,type Slot} from '@/lib/interview-requests';
import {loadInterviewState,readAll} from '@/lib/interview-store';
import {requestDbError} from '@/lib/parent-interview-http';
import {syncInterview} from '@/lib/interview-sync';

export const dynamic='force-dynamic';
export const maxDuration=60;
const studentNumber='2018999';
const lineUserId='BENTAN-KUDO-INTERVIEW-LIVE-PREVIEW';
const notePrefix='【動作確認・実際の面談ではありません】';
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function authorize(staff:{staffCode:string;role:string}){
 if(staff.staffCode!=='KUDO'||!['admin','office','employee'].includes(staff.role))throw new InterviewError('この確認画面を利用できません。',403);
}

export async function GET(request:NextRequest){
 let context;
 try{
  context=await staffContext(request);authorize(context.staff);
  return staffResponse(await parentView(context.dataClient,lineUserId),context);
 }catch(error){return error instanceof InterviewError?staffResponse({error:error.message},context,error.status):staffErrorResponse(error,context);}
}

export async function POST(request:NextRequest){
 let context;let hash='';
 try{
  assertStaffMutationOrigin(request);context=await staffContext(request);authorize(context.staff);
  const body=await staffJsonBody(request);
  if(!uuid(body.operationKey))throw new InterviewError('操作をやり直してください。');
  if(body.action==='decline'){
   if(!uuid(body.id)||!Number.isInteger(body.version))throw new InterviewError('案内を読み直してください。');
   const result=await context.dataClient.rpc('interview_invitation_save',{p_user:context.identity.authUserId,p_session:context.identity.authSessionId,p_operation:body.operationKey,p_action:'decline',p_student:null,p_slots:null,p_expires:null,p_id:body.id,p_version:body.version});
   requestDbError(result.error);return staffResponse({saved:true},context);
  }
  const student=await context.dataClient.from('student_registry').select('interview_student_id').eq('student_number',studentNumber).eq('enrollment_status','current_roster').single();
  if(student.error||!student.data?.interview_student_id)throw new InterviewError('確認用生徒を利用できません。',503);
  if(body.action==='submit'&&body.studentId!==student.data.interview_student_id)throw new InterviewError('確認用生徒を選び直してください。',403);

  hash=createHash('sha256').update(randomBytes(32)).digest('hex');
  const session=await context.dataClient.from('interview_parent_sessions').insert({token_hash:hash,line_user_id:lineUserId,expires_at:new Date(Date.now()+300000).toISOString()});
  if(session.error)throw new InterviewError('申請の準備ができませんでした。',503);

  if(body.action==='withdraw'){
   if(!uuid(body.id)||!Number.isInteger(body.version))throw new InterviewError('申請を選び直してください。');
   const saved=await context.dataClient.rpc('interview_parent_withdraw',{p_hash:hash,p_operation:body.operationKey,p_id:body.id,p_version:body.version});
   requestDbError(saved.error);const bookingId=saved.data?.booking?.id;let sync;
   if(bookingId){try{sync=await syncInterview(context.dataClient,bookingId);}catch{sync={status:'error',message:'予約は取り消しました。Notionの反映は教室で確認します。'};}}
   return staffResponse({saved:true,sync},context);
  }
  if(body.action!=='submit'||!Array.isArray(body.choices)||body.choices.length<1||body.choices.length>3||!body.choices.every(uuid)||new Set(body.choices).size!==body.choices.length||typeof body.note!=='string')throw new InterviewError('日程を重複なく1〜3つ選んでください。');
  const note=`${notePrefix}${body.note.trim()?` ${body.note.trim()}`:''}`;
  if(!uuid(body.invitationId)||!Number.isInteger(body.invitationVersion))throw new InterviewError('案内を読み直してから日程を選んでください。',409);
  if(note.length>1500)throw new InterviewError('相談内容は短くしてください。');
  const subject=await context.dataClient.rpc('interview_parent_subject',{p_hash:hash,p_student:body.studentId});requestDbError(subject.error);
  const prior=await context.dataClient.from('interview_request_events').select('operation_key').eq('operation_key',body.operationKey).maybeSingle();
  if(prior.error)throw new InterviewError('送信結果を確認できません。',503);
  if(!prior.data){
   const invite=await context.dataClient.from('interview_invitations').select('slots').eq('student_id',body.studentId).eq('status','active').gt('expires_at',new Date().toISOString()).maybeSingle();
   if(invite.error)throw new InterviewError('案内を確認できません。',503);
   const invited=invite.data?.slots as {id:string}[]|undefined;
   if(!invited||!body.choices.every(id=>invited.some(s=>s.id===id)))throw new InterviewError('案内された日程を選んでください。',409);
   const state=await loadInterviewState(context.dataClient),slots=await readAll(context.dataClient,'interview_public_slots') as Slot[],subjectStudent=state.students.find(row=>row.id===body.studentId);
   if(!subjectStudent)throw new InterviewError('確認用生徒を利用できません。',503);
   await validateRequestedSlots(body.choices,slots,subjectStudent,state,note);
  }
  const saved=await context.dataClient.rpc('interview_invited_submit',{p_hash:hash,p_operation:body.operationKey,p_student:body.studentId,p_choices:body.choices,p_note:note,p_invitation:body.invitationId,p_version:body.invitationVersion});
  requestDbError(saved.error);return staffResponse({saved:true,request:parentRequest(saved.data,[])},context);
 }catch(error){return error instanceof InterviewError?staffResponse({error:error.message},context,error.status):staffErrorResponse(error,context);}
 finally{if(hash&&context)await context.dataClient.from('interview_parent_sessions').delete().eq('token_hash',hash);}
}
