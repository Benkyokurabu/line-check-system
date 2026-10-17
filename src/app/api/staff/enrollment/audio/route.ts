import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {assertInterviewAccess} from '@/lib/interview-access.mjs';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {transcribeEnrollmentAudio} from '@/lib/enrollment-ai.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(request:NextRequest){let c;try{
 assertStaffMutationOrigin(request);c=await staffContext(request);assertInterviewAccess(c.staff);if(!['admin','office','employee'].includes(c.staff.role))throw new StaffAuthError('permission_denied',403);
 // Read a bounded multipart body, including requests without Content-Length.
 const reader=request.body?.getReader();if(!reader)throw new StaffAuthError('invalid_request',400);const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>3_100_000){await reader.cancel();throw new StaffAuthError('invalid_request',413);}chunks.push(r.value);}}finally{reader.releaseLock();}
 const parsed=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers.get('Content-Type')??''}}).formData();
 const file=parsed.get('audio');if(!(file instanceof File))throw new StaffAuthError('invalid_request',400);
 try{return staffResponse({text:await transcribeEnrollmentAudio(file,{key:process.env.GROQ_API_KEY})},c);}catch(e){return staffResponse({error:e instanceof Error?e.message:'音声を読み取れませんでした。'},c,422);}
 }catch(e){return staffErrorResponse(e,c);}}
