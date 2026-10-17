import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {assertPostInterview} from '@/lib/post-interview-core.mjs';
import {InterviewError} from '@/lib/interview-core.mjs';
import {transcribeEnrollmentAudio} from '@/lib/enrollment-ai.mjs';
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=60;
export async function POST(request:NextRequest){let c;try{
 assertStaffMutationOrigin(request);c=await staffContext(request);assertPostInterview(c.staff);
 const reader=request.body?.getReader();if(!reader)throw new InterviewError('音声ファイルを選んでください。',400);const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>3100000){await reader.cancel();throw new InterviewError('音声は3MB以内にしてください。',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
 const parsed=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers.get('Content-Type')??''}}).formData();const file=parsed.get('audio');if(!(file instanceof File))throw new InterviewError('音声を選んでください。',400);
 try{return staffResponse({text:await transcribeEnrollmentAudio(file,{key:process.env.GROQ_API_KEY})},c);}catch(error){return staffResponse({error:error instanceof Error?error.message:'音声を読み取れませんでした。'},c,422);}
 }catch(error){return error instanceof InterviewError?staffResponse({error:error.message},c,error.status):staffErrorResponse(error,c);}}
