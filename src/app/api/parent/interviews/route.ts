import {NextRequest} from 'next/server';
import {parentContext,parentFailure,parentResponse,requestDbError} from '@/lib/parent-interview-http';
import {parentView,bindingForSlot,type Slot} from '@/lib/interview-requests';
import {loadInterviewState,readAll} from '@/lib/interview-store';
import {assertStaffMutationOrigin,staffJsonBody} from '@/lib/staff-auth-http';
import {InterviewError} from '@/lib/interview-core.mjs';
import {loginConfig,parentCookie} from '@/lib/parent-line-login.mjs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function GET(request:NextRequest){
 try{const c=await parentContext(request);return parentResponse(await parentView(c.db,c.lineUserId));}
 catch(e){if(e instanceof InterviewError&&e.status===401)return parentResponse({loginRequired:true,loginAvailable:!!loginConfig()},401);return parentFailure(e);}
}
export async function DELETE(request:NextRequest){
 try{assertStaffMutationOrigin(request);const c=await parentContext(request);const removed=await c.db.from('interview_parent_sessions').delete().eq('token_hash',c.hash);if(removed.error)throw new InterviewError('終了できませんでした。もう一度お試しください。',503);const r=parentResponse({loggedOut:true});r.cookies.set(parentCookie,'',{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:0});return r;}catch(e){return parentFailure(e);}
}
export async function POST(request:NextRequest){
 try{
  assertStaffMutationOrigin(request);const c=await parentContext(request),body=await staffJsonBody(request);
  if(!uuid(body.operationKey))throw new InterviewError('操作をやり直してください。');
  if(body.action==='withdraw'){
   if(!uuid(body.id)||!Number.isInteger(body.version))throw new InterviewError('申請を選び直してください。');
   const saved=await c.db.rpc('interview_parent_withdraw',{p_hash:c.hash,p_operation:body.operationKey,p_id:body.id,p_version:body.version});requestDbError(saved.error);return parentResponse({saved:true});
  }
  if(body.action!=='submit'||!uuid(body.studentId)||!Array.isArray(body.choices)||body.choices.length<1||body.choices.length>3||!body.choices.every(uuid)||new Set(body.choices).size!==body.choices.length||typeof body.note!=='string'||body.note.length>1500)throw new InterviewError('日程を重複なく1〜3つ選んでください。');
  // Recheck the relationship before reading any student details, even for a retry.
  const subject=await c.db.rpc('interview_parent_subject',{p_hash:c.hash,p_student:body.studentId});requestDbError(subject.error);
  const prior=await c.db.from('interview_request_events').select('operation_key').eq('operation_key',body.operationKey).maybeSingle();if(prior.error)throw new InterviewError('送信結果を確認できません。',503);
  if(!prior.data){
   const state=await loadInterviewState(c.db),slots=await readAll(c.db,'interview_public_slots') as Slot[],student=state.students.find(s=>s.id===body.studentId);
   if(!student)throw new InterviewError('お子さまの登録を確認してください。',403);
   for(const id of body.choices){const slot=slots.find(s=>s.id===id);if(!slot)throw new InterviewError('日程を選び直してください。',409);await bindingForSlot(slot,student,state,body.note);}
  }
  const saved=await c.db.rpc('interview_parent_submit',{p_hash:c.hash,p_operation:body.operationKey,p_student:body.studentId,p_choices:body.choices,p_note:body.note.trim()});requestDbError(saved.error);return parentResponse({saved:true});
 }catch(e){return parentFailure(e);}
}
