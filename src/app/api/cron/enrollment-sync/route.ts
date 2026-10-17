import {NextRequest} from 'next/server';
import {requireAttendanceCronToken} from '@/lib/env';
import {createSupabaseAdminClient} from '@/lib/supabase';
import {notionRequest} from '@/lib/notion';
import {staffResponse} from '@/lib/staff-auth-http';
import {processEnrollment} from '@/lib/enrollment-service.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
async function handle(request:NextRequest){if(!requireAttendanceCronToken(request))return staffResponse({error:'unauthorized'},undefined,401);
 const result=await processEnrollment({db:createSupabaseAdminClient(),request:(path:string,init:RequestInit={})=>notionRequest(path,{...init,cache:'no-store',signal:AbortSignal.timeout(7000)})});
 return staffResponse(result);
}
export const GET=handle;export const POST=handle;
