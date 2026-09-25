import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {InterviewError} from '@/lib/interview-core.mjs';
import {archiveOwnAvailability,listOwnAvailability} from '@/lib/interview-availability-manual';
export const dynamic='force-dynamic';export const maxDuration=60;
function authorize(staff:{role:string}){if(!['admin','office','employee','teacher'].includes(staff.role))throw new InterviewError('予約可を管理する権限がありません。',403);}
export async function GET(request:NextRequest){let context;try{context=await staffContext(request);authorize(context.staff);return staffResponse(await listOwnAvailability(request.nextUrl.searchParams.get('month')??'',context.staff),context);}catch(error){return error instanceof InterviewError?staffResponse({error:error.message},context,error.status):staffErrorResponse(error,context);}}
export async function POST(request:NextRequest){let context;try{assertStaffMutationOrigin(request);context=await staffContext(request);authorize(context.staff);const body=await staffJsonBody(request);if(body.action!=='archive')throw new InterviewError('操作を選び直してください。',422);return staffResponse({saved:await archiveOwnAvailability(context.dataClient,context.staff,String(body.pageId??''),String(body.editedAt??''),String(body.operationKey??''))},context);}catch(error){return error instanceof InterviewError?staffResponse({error:error.message},context,error.status):staffErrorResponse(error,context);}}
