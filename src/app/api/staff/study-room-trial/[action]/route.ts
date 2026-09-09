import {NextRequest} from 'next/server';
import {staffContext,staffJsonBody,staffResponse,staffErrorResponse,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {createStaffStudyRoomTrial} from '@/lib/staff-study-room-trial.mjs';
import {getJapanDate,isValidReservationDate} from '@/lib/reservation-date.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
type Params={params:Promise<{action:string}>};
const staffActions=new Set(['requests','intake-options','visit-history','intake','transition','visits']);

async function handle(request:NextRequest,params:Params,mutate:boolean){
 let context:Awaited<ReturnType<typeof staffContext>>|undefined;
 try{
  if(mutate)assertStaffMutationOrigin(request);
  context=await staffContext(request);
  if(!['admin','office'].includes(context.staff.role))throw new StaffAuthError('permission_denied',403);
  const {action}=await params.params;
  if(!staffActions.has(action)&&!['student','reset'].includes(action))throw new StaffAuthError('invalid_request',404);
  if(mutate&&!['student','reset','intake','transition','visits'].includes(action)||!mutate&&['reset','intake','transition','visits'].includes(action))throw new StaffAuthError('invalid_request',405);
  const table=context.dataClient.from('staff_study_room_trial_state');
  const {data:stored,error}=await table.select('version,state,audit').eq('id','main').single();
  if(error||!stored)throw new StaffAuthError('auth_unavailable',503);
  const room=createStaffStudyRoomTrial(stored.state,true);
  const input=mutate?await staffJsonBody(request):null;
  const staff=context.staff;
  const actor={role:staff.role,displayName:staff.displayName,staffCode:staff.staffCode};
  let result:unknown;
  if(action==='reset'){
    if(staff.role!=='admin'||input?.confirm!=='reset-trial-only')throw new StaffAuthError('permission_denied',403);
    room.reset();result={reset:true};
  }else if(action==='student'){
    if(staff.role!=='admin'||!['KUDO','KINJO'].includes(staff.staffCode))throw new StaffAuthError('permission_denied',403);
    const subject=`TRIAL-${staff.staffCode}`;
    const date=String(mutate?input?.date??getJapanDate():request.nextUrl.searchParams.get('date')??getJapanDate());
    if(!isValidReservationDate(date)||date<getJapanDate())throw new StaffAuthError('invalid_request',400);
    if(!mutate){
      const rows=room.snapshot().rows;
      result={studentName:staff.displayName,date,requests:rows.filter((r:{student_number:string})=>r.student_number===subject),
        booked:rows.filter((r:{status:string;reservation_date:string})=>r.status==='approved'&&r.reservation_date===date).flatMap((r:{seat:number;slot_ids:string[]})=>r.slot_ids.map(slotId=>({seat:r.seat,slotId}))),
        closedSlotIds:['20:25-21:55']};
    }else if(input?.action==='submit'){
      result=room.handle('/api/staff/study-room/intake',{method:'POST',body:JSON.stringify({operationKey:input.operationKey,studentNumber:subject,date,seat:input.seat,slotIds:input.slotIds,contactChannel:'other',note:'生徒としての操作確認'})},actor);
    }else if(input?.action==='cancel'){
      const own=room.snapshot().rows.find((r:{id:string;student_number:string})=>r.id===input.requestId&&r.student_number===subject);
      if(!own)throw new StaffAuthError('permission_denied',403);
      result=room.handle('/api/staff/study-room/transition',{method:'POST',body:JSON.stringify({operationKey:input.operationKey,requestId:input.requestId,expectedVersion:input.expectedVersion,action:'cancel',reason:'生徒からの取消確認'})},actor);
    }else throw new StaffAuthError('invalid_request',400);
  }else{
    result=room.handle(`/api/staff/study-room/${action}${request.nextUrl.search}`,mutate?{method:'POST',body:JSON.stringify(input)}:undefined,actor);
  }
  if(mutate){
    const snapshot=room.snapshot();
    const audit=[...(Array.isArray(stored.audit)?stored.audit:[]),{at:new Date().toISOString(),staffId:staff.staffId,action,operationKey:input?.operationKey??null}].slice(-1000);
    const update=await context.dataClient.from('staff_study_room_trial_state').update({state:snapshot,audit,version:stored.version+1,updated_at:new Date().toISOString()}).eq('id','main').eq('version',stored.version).select('version');
    if(update.error)throw new StaffAuthError('auth_unavailable',503);
    if(!update.data?.length)throw new StaffAuthError('reservation_conflict',409);
  }
  return staffResponse(result,context);
 }catch(error){
  if(!(error instanceof StaffAuthError)&&typeof (error as {status?:unknown})?.status==='number'){
    const status=(error as {status:number}).status;
    return staffResponse({error:(error as Error).message,code:'trial_operation_failed'},context,status);
  }
  return staffErrorResponse(error,context);
 }
}
export function GET(request:NextRequest,params:Params){return handle(request,params,false);}
export function POST(request:NextRequest,params:Params){return handle(request,params,true);}
