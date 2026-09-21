import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {InterviewError} from '@/lib/interview-core.mjs';
import {loadInterviewState,readAll} from '@/lib/interview-store';
import {available,refreshHomeroomSlots,type Slot} from '@/lib/interview-requests';
import {invitationStudents} from '@/lib/interview-invitation-students.mjs';
import {requestDbError} from '@/lib/parent-interview-http';
import {sendPilotNotification} from '@/lib/interview-pilot-notification.mjs';
import {loadInvitationSurveyResponses} from '@/lib/interview-surveys-notion';
export const dynamic='force-dynamic';export const maxDuration=60;
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function authorize(staff:{staffCode:string;role:string}){if(staff.staffCode!=='KUDO'||!['admin','office','employee'].includes(staff.role))throw new InterviewError('現在は工藤専用の検証です。',403);}
export async function GET(request:NextRequest){let context;try{
 context=await staffContext(request);authorize(context.staff);const db=context.dataClient;
 const state=await loadInterviewState(db);
 if(request.nextUrl.searchParams.get('slots')==='1'){
  const students=state.students.filter(s=>s.student_number==='2018999'&&s.enrollment_status==='current_roster');
  await refreshHomeroomSlots(db,students,state);const slots=await readAll(db,'interview_public_slots') as Slot[];
  return staffResponse({slots:students.flatMap(s=>slots.filter(slot=>available(slot,state,s.homeroom_teacher)).map(slot=>({...slot.data,id:slot.id,version:slot.version,studentId:s.id})))},context);
 }
 let survey;try{survey=await loadInvitationSurveyResponses(state.students);}catch{throw new InterviewError('Notionのアンケートを取得できません。未提出の判定は行っていません。',503);}
 const [invitations,notifications,config,requests]=await Promise.all([
  db.from('interview_invitations').select('id,student_id,teacher,slots,expires_at,status,version,created_at,notification_status,error,sent_at').order('created_at',{ascending:false}).limit(100),
  db.from('interview_pilot_notifications').select('booking_id,status,error,sent_at').order('created_at',{ascending:false}).limit(100),
  db.from('interview_pilot_notification_config').select('enabled').eq('id',true).maybeSingle(),
  db.from('interview_parent_requests').select('invitation_id,status,booking_id').not('invitation_id','is',null).order('created_at',{ascending:false}).limit(500),
 ]);
 if(invitations.error||notifications.error||config.error||requests.error)throw new InterviewError('案内の状態を取得できません。',503);
 return staffResponse({...invitationStudents(state.students,survey.rows),unmatchedSurveys:survey.unmatched,invitations:invitations.data.map(i=>{const r=requests.data.find(r=>r.invitation_id===i.id);return {...i,answerStatus:r?.status==='approved'?state.bookings.find(b=>b.id===r.booking_id)?.status:r?.status??'unanswered'};}),notifications:notifications.data,pilotReady:config.data?.enabled===true},context);
}catch(e){return e instanceof InterviewError?staffResponse({error:e.message},context,e.status):staffErrorResponse(e,context);}}
export async function POST(request:NextRequest){let context;try{
 assertStaffMutationOrigin(request);context=await staffContext(request);authorize(context.staff);const body=await staffJsonBody(request),db=context.dataClient;
 if(body.action==='retryInvitation'||body.action==='retryConfirmation'){
  if(!uuid(body.id))throw new InterviewError('通知を選択してください。');
  return staffResponse({notification:await sendPilotNotification({db,bookingId:body.action==='retryConfirmation'?String(body.id):undefined,invitationId:body.action==='retryInvitation'?String(body.id):undefined,staffCode:context.staff.staffCode,token:process.env.LINE_CHANNEL_ACCESS_TOKEN})},context);
 }
 if(!uuid(body.operationKey)||!['create','revoke'].includes(String(body.action)))throw new InterviewError('操作をやり直してください。');
 if(body.action==='create'&&(!uuid(body.studentId)||!Array.isArray(body.slots)||!body.slots.length||body.slots.length>200||!body.slots.every(s=>s&&uuid(s.id)&&Number.isInteger(s.version))||typeof body.expiresAt!=='string'||!Number.isFinite(Date.parse(body.expiresAt))))throw new InterviewError('生徒・日程・回答期限を選択してください。');
 if(body.action==='revoke'&&(!uuid(body.id)||!Number.isInteger(body.version)))throw new InterviewError('案内を選び直してください。');
 const saved=await db.rpc('interview_invitation_save',{p_user:context.identity.authUserId,p_session:context.identity.authSessionId,p_operation:body.operationKey,p_action:body.action,p_student:body.studentId??null,p_slots:body.slots??null,p_expires:body.expiresAt??null,p_id:body.id??null,p_version:body.version??null});requestDbError(saved.error);
 const notification=body.action==='create'?await sendPilotNotification({db,invitationId:saved.data.id,staffCode:context.staff.staffCode,token:process.env.LINE_CHANNEL_ACCESS_TOKEN}):undefined;
 return staffResponse({saved:saved.data,notification},context);
}catch(e){return e instanceof InterviewError?staffResponse({error:e.message},context,e.status):staffErrorResponse(e,context);}}
