import {NextRequest} from 'next/server';
import {requireAttendanceCronToken} from '@/lib/env';
import {createSupabaseAdminClient} from '@/lib/supabase';
import {staffResponse} from '@/lib/staff-auth-http';
import {syncBenkei} from '@/lib/benkei-sync';
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=60;
export async function POST(request:NextRequest){
 if(!requireAttendanceCronToken(request))return staffResponse({error:'unauthorized'},undefined,401);
 try{return staffResponse(await syncBenkei(createSupabaseAdminClient()));}
 catch{return staffResponse({error:'benkei_sync_failed'},undefined,503);}
}
