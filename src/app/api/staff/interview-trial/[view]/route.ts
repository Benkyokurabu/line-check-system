import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,assertStaffMutationOrigin,staffJsonBody} from '@/lib/staff-auth-http';
import {assertInterviewAccess} from '@/lib/interview-access.mjs';
import {InterviewError} from '@/lib/interview-core.mjs';
import {readInterviewTrial,changeInterviewTrial} from '@/lib/interview-trial.mjs';
export const dynamic='force-dynamic';
type Params={params:Promise<{view:string}>};
async function handle(request:NextRequest,params:Params,write:boolean){
 let context;
 try{
  if(write)assertStaffMutationOrigin(request);
  context=await staffContext(request);assertInterviewAccess(context.staff);
  const {view}=await params.params;
  if(!['student','staff'].includes(view))throw new InterviewError('画面を確認してください。',404);
  if(view==='staff'&&!['admin','office','employee'].includes(context.staff.role))throw new InterviewError('職員側の操作権限がありません。',403);
  const {data,error}=await context.dataClient.from('staff_interview_trial_state').select('version,state').eq('id','main').single();
  if(error||!data)throw new InterviewError('面談の確認用データを取得できません。',503);
  if(!write)return staffResponse(readInterviewTrial(data.state,context.staff,view),context);
  const input=await staffJsonBody(request);
  const changed=changeInterviewTrial(data.state,context.staff,view,input);
  if(!changed.replayed){
   const update=await context.dataClient.from('staff_interview_trial_state').update({state:changed.state,version:data.version+1,updated_at:new Date().toISOString()}).eq('id','main').eq('version',data.version).select('version');
   if(update.error)throw new InterviewError('確認用の申請を保存できません。再試行してください。',503);
   if(!update.data?.length)throw new InterviewError('別の操作で状況が変わりました。最新の状況を確認してください。',409);
  }
  return staffResponse(changed.result,context);
 }catch(e){return e instanceof InterviewError?staffResponse({error:e.message},context,e.status):staffErrorResponse(e,context);}
}
export function GET(request:NextRequest,params:Params){return handle(request,params,false);}
export function POST(request:NextRequest,params:Params){return handle(request,params,true);}
