import {NextRequest} from 'next/server';
import {requireAttendanceCronToken} from '@/lib/env';
import {createSupabaseAdminClient} from '@/lib/supabase';
import {staffResponse} from '@/lib/staff-auth-http';
import {sendFeedbackNotifications} from '@/lib/feedback-notifications.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
async function handle(request:NextRequest){
 if(!requireAttendanceCronToken(request))return staffResponse({error:'unauthorized'},undefined,401);
 const result=await sendFeedbackNotifications({db:createSupabaseAdminClient(),token:process.env.LINE_CHANNEL_ACCESS_TOKEN});
 return staffResponse(result,undefined,result.status==='unavailable'||result.status==='retry'?503:200);
}
export const POST=handle;
export const GET=handle;
