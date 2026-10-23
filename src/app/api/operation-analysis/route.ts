import {NextRequest} from 'next/server';
import {assertStaffMutationOrigin,staffContext,staffErrorResponse,staffJsonBody,staffResponse} from '@/lib/staff-auth-http';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {checkedDiagnostic} from '@/lib/operation-diagnostics.mjs';
import {analyzeOperation} from '@/lib/operation-analysis.mjs';
import {OPERATION_SUPPORT_COOKIE,operationSupportActor,verifyOperationSupportToken} from '@/lib/operation-support-token.mjs';
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=25;
const recent=new Map<string,{at:number;count:number}>();
export async function POST(request:NextRequest){let c:Awaited<ReturnType<typeof staffContext>>|undefined;
 try{
  assertStaffMutationOrigin(request);
  const body=await staffJsonBody(request,1024);
  let diagnostic;try{diagnostic=checkedDiagnostic(body);}catch{throw new StaffAuthError('invalid_request',400);}
  const support=verifyOperationSupportToken(request.cookies.get(OPERATION_SUPPORT_COOKIE)?.value,process.env.SUPABASE_SECRET_KEY);
  if(!support)c=await staffContext(request);
  const now=Date.now(),id=support?.actor??operationSupportActor(c!.staff.staffId,process.env.SUPABASE_SECRET_KEY),stored=recent.get(id),previous=stored&&now-stored.at<60_000?stored:undefined;
  for(const [k,v] of recent)if(now-v.at>60_000)recent.delete(k);
  if(previous&&now-previous.at<60_000&&previous.count>=4)return staffResponse({code:'analysis_rate_limited'},c,429);
  if(recent.size>=1000)return staffResponse({code:'analysis_unavailable'},c,503);
  recent.set(id,{at:previous?.at??now,count:(previous?.count??0)+1});
  try{return staffResponse({analysis:await analyzeOperation(diagnostic,{key:process.env.GROQ_API_KEY,model:process.env.OPERATION_AI_MODEL??'openai/gpt-oss-120b'}),label:'AIによる分析',certainty:'推定を含みます。'},c);}
  catch{return staffResponse({code:'analysis_unavailable'},c,503);}
 }catch(error){return staffErrorResponse(error,c);}
}
