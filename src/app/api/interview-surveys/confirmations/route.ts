import {NextRequest} from 'next/server';
import {assertStaffMutationOrigin,staffContext,staffJsonBody,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {loadInterviewSurveyGroups} from '@/lib/interview-surveys-notion';
import {surveyPageId,validateSurveyChanges} from '@/lib/survey-confirmations.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
async function readStates(context:Awaited<ReturnType<typeof staffContext>>,ids:Set<string|null>){
 const {data,error}=await context.dataClient.from('survey_confirmations').select('page_id,confirmed,version,updated_at,staff_accounts(display_name)').order('page_id').limit(10000);
 if(error)throw new Error('read_failed');
 return (data??[]).filter(s=>ids.has(s.page_id)).map(s=>({page_id:s.page_id,confirmed:s.confirmed,version:s.version,updated_at:s.updated_at,updated_name:(Array.isArray(s.staff_accounts)?s.staff_accounts[0]:s.staff_accounts)?.display_name??'職員'}));
}
let idsCache:{until:number;value:Promise<Set<string|null>>}|undefined;
function answerIds(){
 if(idsCache&&idsCache.until>Date.now())return idsCache.value;
 const value=loadInterviewSurveyGroups().then(groups=>new Set(groups.flatMap(g=>g.students.map(s=>surveyPageId(s.notionUrl)))));
 idsCache={until:Date.now()+60000,value};
 void value.catch(()=>{if(idsCache?.value===value)idsCache=undefined;});
 return value;
}
export async function GET(request:NextRequest){
 let context;
 try{context=await staffContext(request);return staffResponse({states:await readStates(context,await answerIds())},context);}
 catch(e){return staffErrorResponse(e,context);}
}
export async function POST(request:NextRequest){
 let context;
 try{
  assertStaffMutationOrigin(request);context=await staffContext(request);
  const body=await staffJsonBody(request,32768);
  if(body.clientVersion!==2)return staffResponse({error:'共有方法が更新されました。画面を再読み込みしてください。端末の記録は残っています。'},context,409);
  const changes=validateSurveyChanges(body.changes);
  const ids=await answerIds();
  if(changes.some(c=>!ids.has(c.pageId)))throw new StaffAuthError('invalid_request',400);
  const {error}=await context.dataClient.rpc('save_survey_confirmations',{p_staff_id:context.staff.staffId,p_changes:changes});
  if(error?.message==='survey_conflict')return staffResponse({error:'他の先生が更新しています。',states:await readStates(context,ids)},context,409);
  if(error)return staffResponse({error:'保存できませんでした。変更は残っています。再試行してください。'},context,503);
  return staffResponse({saved:true,states:await readStates(context,ids)},context);
 }catch(e){return staffErrorResponse(e instanceof Error&&e.message==='invalid_request'?new StaffAuthError('invalid_request',400):e,context);}
}
