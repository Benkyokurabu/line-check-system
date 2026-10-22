import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {assertSchoolContext} from '@/lib/school-context-core.mjs';
import {syncSchoolContext} from '@/lib/school-context-sync.mjs';
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=60;
type Context=Awaited<ReturnType<typeof staffContext>>;
function database<T>(result:{data:T;error:unknown}):T{if(result.error){if(String((result.error as {message?:string}).message??'').includes('context_evidence_stale'))throw new StaffAuthError('context_evidence_stale',409);throw new StaffAuthError('auth_unavailable',503);}return result.data;}
function errorResponse(error:unknown,c?:Context){if(error instanceof StaffAuthError&&error.code==='context_evidence_stale')return staffResponse({error:'根拠の原文が更新中または確認できない状態です。原文を再確認してから判断してください。',code:'context_evidence_stale'},c,409);return staffErrorResponse(error,c);}
export async function GET(request:NextRequest){let c:Context|undefined;try{
 c=await staffContext(request);assertSchoolContext(c.staff);const q=request.nextUrl.searchParams;
 const view=q.get('view')??'summary',limit=Number(q.get('limit')??20);
 if(!['summary','list','search','proposals','coverage'].includes(view)||!Number.isInteger(limit)||limit<1||limit>100||(q.get('q')??'').length>200||(q.get('studentId')??'').length>100)throw new StaffAuthError('invalid_request',400);
 return staffResponse(database(await c.dataClient.rpc('school_context_read',{p_user:c.identity.authUserId,p_session:c.identity.authSessionId,p_view:view,p_query:q.get('q')??'',p_student:q.get('studentId')??'',p_limit:limit})),c);
}catch(error){return errorResponse(error,c);}}
export async function POST(request:NextRequest){let c:Context|undefined;try{
 assertStaffMutationOrigin(request);c=await staffContext(request);assertSchoolContext(c.staff);const body=await staffJsonBody(request);
 if(body.action==='sync')return staffResponse(await syncSchoolContext({db:c.dataClient,token:process.env.NOTION_TOKEN??process.env.NOTION_API_KEY}),c);
 if(body.action!=='decision'||typeof body.proposalId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.proposalId)||!['accepted','held','dismissed'].includes(String(body.decision))||typeof(body.reason??'')!=='string'||String(body.reason??'').length>2000)throw new StaffAuthError('invalid_request',400);
 return staffResponse(database(await c.dataClient.rpc('school_context_decide',{p_user:c.identity.authUserId,p_session:c.identity.authSessionId,p_proposal:body.proposalId,p_decision:body.decision,p_reason:body.reason??''})),c);
}catch(error){return errorResponse(error,c);}}
