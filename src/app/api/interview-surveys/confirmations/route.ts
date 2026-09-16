import {NextRequest} from 'next/server';
import {createSupabaseAdminClient} from '@/lib/supabase';
import {assertStaffMutationOrigin,staffContext,staffJsonBody,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {loadInterviewSurveyGroups} from '@/lib/interview-surveys-notion';
import {surveyPageId,validateSurveyChanges} from '@/lib/survey-confirmations.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(){
 const {data,error}=await createSupabaseAdminClient().from('survey_confirmations').select('page_id,confirmed,version').order('page_id').limit(10000);
 return error?staffResponse({error:'確認状態を読み込めませんでした。'},undefined,503):staffResponse({states:data});
}
export async function POST(request:NextRequest){
 let context;
 try{
  assertStaffMutationOrigin(request);context=await staffContext(request);
  const body=await staffJsonBody(request,32768);
  const changes=validateSurveyChanges(body.changes);
  const groups=await loadInterviewSurveyGroups();
  const ids=new Set(groups.flatMap(g=>g.students.map(s=>surveyPageId(s.notionUrl))));
  if(changes.some(c=>!ids.has(c.pageId)))throw new StaffAuthError('invalid_request',400);
  const {error}=await context.dataClient.rpc('save_survey_confirmations',{p_staff_id:context.staff.staffId,p_changes:changes});
  if(error?.message==='survey_conflict')return staffResponse({error:'他の先生が更新しています。この画面の変更は未保存です。内容を確認し、反映する場合はもう一度保存してください。'},context,409);
  if(error)return staffResponse({error:'保存できませんでした。変更は残っています。再試行してください。'},context,503);
  return staffResponse({saved:true},context);
 }catch(e){return staffErrorResponse(e instanceof Error&&e.message==='invalid_request'?new StaffAuthError('invalid_request',400):e,context);}
}
