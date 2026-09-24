import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {assertInterviewAccess} from '@/lib/interview-access.mjs';
import {InterviewError} from '@/lib/interview-core.mjs';
import {applyGeneratedAvailability,previewGeneratedAvailability} from '@/lib/interview-generated-availability';
export const dynamic='force-dynamic';export const maxDuration=120;
function assertKudo(staff:{staffCode:string;role:string}){assertInterviewAccess(staff);if(staff.staffCode!=='KUDO'||staff.role!=='admin')throw new InterviewError('工藤先生の管理者画面から実行してください。',403);}
export async function GET(request:NextRequest){let context;try{context=await staffContext(request);assertKudo(context.staff);return staffResponse(await previewGeneratedAvailability(context.dataClient,request.nextUrl.searchParams.get('month')??''),context);}catch(error){return error instanceof InterviewError?staffResponse({error:error.message},context,error.status):staffErrorResponse(error,context);}}
export async function POST(request:NextRequest){let context;try{assertStaffMutationOrigin(request);context=await staffContext(request);assertKudo(context.staff);const body=await staffJsonBody(request);const result=await applyGeneratedAvailability(context.dataClient,{month:String(body.month??''),teacher:'工藤',previewHash:String(body.previewHash??''),operationKey:String(body.operationKey??''),actor:context.staff.staffId});return staffResponse({saved:result},context);}catch(error){return error instanceof InterviewError?staffResponse({error:error.message},context,error.status):staffErrorResponse(error,context);}}
