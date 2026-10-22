import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {InterviewError} from '@/lib/interview-core.mjs';
import {assertPostInterview} from '@/lib/post-interview-core.mjs';
import {postRead} from '@/lib/post-interview-context';
import {enrollmentSearch} from '@/lib/enrollment-service.mjs';
import {parentContactOptions} from '@/lib/parent-contact-cloud.mjs';
import {readVisit,visitContext,saveVisit} from '@/lib/visit-followup-service.mjs';
import {processPostEntry,postDatabase} from '@/lib/post-interview-service.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
type Context=Awaited<ReturnType<typeof staffContext>>;
const failure=(e:unknown,c?:Context)=>e instanceof InterviewError?staffResponse({error:e.message},c,e.status):staffErrorResponse(e,c);
export async function GET(request:NextRequest){let c:Context|undefined;try{
 c=await staffContext(request);assertPostInterview(c.staff);const q=request.nextUrl.searchParams;
 if(q.has('q'))return staffResponse(await enrollmentSearch(postRead,q.get('q')),c);
 if(q.has('worklogMonth'))return staffResponse(await parentContactOptions(c.dataClient,process.env.SUPABASE_SECRET_KEY,q.get('worklogMonth')),c);
 if(q.has('status'))return staffResponse({entry:await readVisit(c.dataClient,q.get('status'))},c);
 if(q.has('student')||q.has('entry'))return staffResponse(await visitContext({db:c.dataClient,request:postRead,staff:c.staff,studentPageId:q.get('student')??'',entryId:q.get('entry')??'',intakePageId:q.get('intake'),recordSelection:q.get('record')}),c);
 const entries=postDatabase(await c.dataClient.from('post_interview_entries').select('id,payload,status,version,updated_at').contains('payload',{workflow:'visit-followup'}).order('updated_at',{ascending:false}).limit(60));return staffResponse({entries},c);
 }catch(e){return failure(e,c);}}
export async function POST(request:NextRequest){let c:Context|undefined;try{
 assertStaffMutationOrigin(request);c=await staffContext(request);assertPostInterview(c.staff);const body=await staffJsonBody(request,150000);
 const entry=await saveVisit({db:c.dataClient,request:postRead,body,context:c});
 await processPostEntry({db:c.dataClient,request:postRead,id:entry.id,recipients:async()=>[],cloudKey:process.env.SUPABASE_SECRET_KEY??''});
 return staffResponse({entry:await readVisit(c.dataClient,entry.id)},c);
 }catch(e){return failure(e,c);}}
