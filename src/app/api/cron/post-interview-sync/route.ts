import {NextRequest} from 'next/server';
import {requireAttendanceCronToken} from '@/lib/env';
import {createSupabaseAdminClient} from '@/lib/supabase';
import {staffResponse} from '@/lib/staff-auth-http';
import {postRead,postRecipients} from '@/lib/post-interview-context';
import {processPostEntry} from '@/lib/post-interview-service.mjs';
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=60;
async function handle(request:NextRequest){if(!requireAttendanceCronToken(request))return staffResponse({error:'unauthorized'},undefined,401);
 const db=createSupabaseAdminClient();return staffResponse(await processPostEntry({db,request:postRead,recipients:(number:string)=>postRecipients(db,number),lineToken:process.env.LINE_CHANNEL_ACCESS_TOKEN??'',cloudKey:process.env.SUPABASE_SECRET_KEY??''}));
}
export const GET=handle;export const POST=handle;
