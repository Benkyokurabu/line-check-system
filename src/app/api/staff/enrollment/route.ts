import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {assertInterviewAccess} from '@/lib/interview-access.mjs';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {InterviewError} from '@/lib/interview-core.mjs';
import {notionRequest} from '@/lib/notion';
import {enrollmentList,enrollmentRead,enrollmentSearch,enrollmentContext,saveEnrollment,processEnrollment,retryEnrollment,enrollmentHistory} from '@/lib/enrollment-service.mjs';
import {draftEnrollmentRecord} from '@/lib/enrollment-ai.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const read=(path:string,init:RequestInit={})=>notionRequest(path,{...init,cache:'no-store',signal:AbortSignal.timeout(7000)});
function access(context:Awaited<ReturnType<typeof staffContext>>){assertInterviewAccess(context.staff);if(!['admin','office','employee'].includes(context.staff.role))throw new StaffAuthError('permission_denied',403);}
function failure(e:unknown,c?:Awaited<ReturnType<typeof staffContext>>){return e instanceof InterviewError?staffResponse({error:e.message},c,e.status):staffErrorResponse(e,c);}
export async function GET(request:NextRequest){let c;try{
 c=await staffContext(request);access(c);const q=request.nextUrl.searchParams;
 if(q.has('q'))return staffResponse(await enrollmentSearch(read,q.get('q')),c);
 if(q.has('status'))return staffResponse({entry:await enrollmentRead(c.dataClient,q.get('status'))},c);
 if(q.has('entry')||q.has('student'))return staffResponse(await enrollmentContext({db:c.dataClient,request:read,entryId:q.get('entry'),studentPageId:q.get('student'),staff:c.staff}),c);
 if(q.has('history'))return staffResponse({history:await enrollmentHistory(read,q.get('history'))},c);
 return staffResponse({entries:await enrollmentList(c.dataClient)},c);
 }catch(e){return failure(e,c);}}
export async function POST(request:NextRequest){let c;try{
 assertStaffMutationOrigin(request);c=await staffContext(request);access(c);const body=await staffJsonBody(request,150000);
 if(body.action==='draft'){try{return staffResponse(await draftEnrollmentRecord(body.sourceText,{key:process.env.GROQ_API_KEY}),c);}catch(e){return staffResponse({error:e instanceof Error?e.message:'文章を作成できませんでした。'},c,503);}}
 let entry;
 if(body.action==='retry'){entry=await retryEnrollment(c.dataClient,body.id);}
 else if(body.action==='save'){entry=await saveEnrollment({db:c.dataClient,request:read,body,context:c});}
 else throw new InterviewError('操作を選び直してください。',422);
 // The queue is committed first; the cron worker continues even if this request ends.
 await processEnrollment({db:c.dataClient,request:read,id:entry.id});
 return staffResponse({entry:await enrollmentRead(c.dataClient,entry.id)},c);
 }catch(e){return failure(e,c);}}
