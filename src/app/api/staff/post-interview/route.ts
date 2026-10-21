import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {InterviewError} from '@/lib/interview-core.mjs';
import {assertPostInterview} from '@/lib/post-interview-core.mjs';
import {postRead,postAnswerOptions,verifiedPostAnswer,postRecipients} from '@/lib/post-interview-context';
import {readPostEntry,postEntries,savePostEntry,savePostLine,processPostEntry} from '@/lib/post-interview-service.mjs';
import {preparePostContext} from '@/lib/post-interview-notion.mjs';
import {draftPostInterview} from '@/lib/post-interview-ai.mjs';
import {parentContactOptions} from '@/lib/parent-contact-cloud.mjs';
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=60;
type Context=Awaited<ReturnType<typeof staffContext>>;
function failure(error:unknown,c?:Context){return error instanceof InterviewError?staffResponse({error:error.message},c,error.status):staffErrorResponse(error,c);}
export async function GET(request:NextRequest){let c:Context|undefined;try{
 c=await staffContext(request);assertPostInterview(c.staff);const q=request.nextUrl.searchParams;
 if(q.has('worklogMonth'))return staffResponse(await parentContactOptions(c.dataClient,process.env.SUPABASE_SECRET_KEY,q.get('worklogMonth')),c);
 if(q.has('q'))return staffResponse({answers:await postAnswerOptions(c.dataClient,q.get('q')??'')},c);
 const entry=q.get('entry')?await readPostEntry(c.dataClient,q.get('entry')):null;
 if(q.has('status'))return staffResponse({entry:await readPostEntry(c.dataClient,q.get('status'))},c);
 const answerId=entry?.answer_page_id??q.get('answer')??'';
 const verified=await verifiedPostAnswer(c.dataClient,answerId);
 const data=await preparePostContext({request:postRead,verified,entry,recordId:q.get('record')??'',staff:c.staff});
 return staffResponse({...data,accounts:await postRecipients(c.dataClient,String(verified.student.student_number)),entries:await postEntries(c.dataClient,answerId)},c);
 }catch(error){return failure(error,c);}}
export async function POST(request:NextRequest){let c:Context|undefined;try{
 assertStaffMutationOrigin(request);c=await staffContext(request);assertPostInterview(c.staff);const body=await staffJsonBody(request,350000);
 if(body.action==='draft-ai'){try{return staffResponse(await draftPostInterview(body.sourceText,{key:process.env.GROQ_API_KEY}),c);}catch(error){return staffResponse({error:error instanceof Error?error.message:'候補を作成できませんでした。'},c,503);}}
 if(body.action!=='save'&&body.action!=='send-line')throw new InterviewError('保存する操作を確認してください。',422);
 const owner=c;
 const saveArgs={db:c.dataClient,body,context:c,verifyAnswer:(id:string)=>verifiedPostAnswer(owner.dataClient,id),recipients:(number:string)=>postRecipients(owner.dataClient,number)};
 const entry=body.action==='send-line'?await savePostLine(saveArgs):await savePostEntry({...saveArgs,request:postRead});
 await processPostEntry({db:c.dataClient,request:postRead,id:entry.id,recipients:(number:string)=>postRecipients(owner.dataClient,number),lineToken:process.env.LINE_CHANNEL_ACCESS_TOKEN??'',cloudKey:process.env.SUPABASE_SECRET_KEY??'',lineOnly:body.action==='send-line'});
 return staffResponse({entry:await readPostEntry(c.dataClient,entry.id)},c);
 }catch(error){return failure(error,c);}}
