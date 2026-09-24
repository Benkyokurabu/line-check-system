import {NextRequest} from 'next/server';
import {createSupabaseAdminClient} from '@/lib/supabase';
import {staffJsonBody,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
import {StaffAuthError,isStaffSameOrigin} from '@/lib/staff-auth-core.mjs';
import {loadInterviewSurveyGroups} from '@/lib/interview-surveys-notion';
import {surveyPageId,validateSurveyChanges} from '@/lib/survey-confirmations.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
async function readStates(client:ReturnType<typeof createSupabaseAdminClient>,ids?:Set<string|null>){
 const {data,error}=await client.from('survey_confirmations').select('page_id,confirmed,progress_status,version,updated_at,updated_by').order('page_id').limit(10000);
 if(error)throw new Error('read_failed');
 return (data??[]).filter(s=>!ids||ids.has(s.page_id)).map(s=>({page_id:s.page_id,confirmed:s.confirmed,progress_status:s.progress_status,version:s.version,updated_at:s.updated_at,updated_name:s.updated_by?'職員による保存':'共有操作'}));
}
let idsCache:{until:number;value:Promise<Set<string|null>>}|undefined;
function answerIds(){
 if(idsCache&&idsCache.until>Date.now())return idsCache.value;
 const value=loadInterviewSurveyGroups().then(groups=>new Set(groups.flatMap(g=>g.students.map(s=>surveyPageId(s.notionUrl)))));
 idsCache={until:Date.now()+60000,value};
 void value.catch(()=>{if(idsCache?.value===value)idsCache=undefined;});
 return value;
}
export async function GET(){
 try{return staffResponse({states:await readStates(createSupabaseAdminClient())});}
 catch{return staffResponse({error:'対応状況を読み込めませんでした。'},undefined,503);}
}
export async function POST(request:NextRequest){
 try{
  if(!isStaffSameOrigin(request,process.env.STAFF_AUTH_ORIGIN))throw new StaffAuthError('origin_denied',403);
  const body=await staffJsonBody(request,32768);
  if(![2,3].includes(Number(body.clientVersion)))return staffResponse({error:'共有方法が更新されました。画面を再読み込みしてください。端末の記録は残っています。'},undefined,409);
  const changes=validateSurveyChanges(body.changes);
  const ids=await answerIds();
  if(changes.some(c=>!ids.has(c.pageId)))throw new StaffAuthError('invalid_request',400);
  const client=createSupabaseAdminClient();
  const {error}=await client.rpc('save_shared_survey_confirmations',{p_changes:changes});
  if(error?.message==='survey_conflict')return staffResponse({error:'他の先生が更新しています。',states:await readStates(client,ids)},undefined,409);
  if(error)return staffResponse({error:'保存できませんでした。変更は残っています。再試行してください。'},undefined,503);
  return staffResponse({saved:true,states:await readStates(client,ids)});
 }catch(e){
  if(e instanceof StaffAuthError)return staffErrorResponse(e);
  if(e instanceof Error&&e.message==='invalid_request')return staffErrorResponse(new StaffAuthError('invalid_request',400));
  return staffResponse({error:'保存できませんでした。変更はこの端末に残っています。再試行してください。'},undefined,503);
 }
}
