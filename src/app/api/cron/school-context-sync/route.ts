import {NextRequest} from 'next/server';
import {requireAttendanceCronToken} from '@/lib/env';
import {createSupabaseAdminClient} from '@/lib/supabase';
import {staffResponse} from '@/lib/staff-auth-http';
import {syncSchoolContext} from '@/lib/school-context-sync.mjs';
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=60;
export async function POST(request:NextRequest){
 if(!requireAttendanceCronToken(request))return staffResponse({error:'unauthorized'},undefined,401);
 try{return staffResponse(await syncSchoolContext({db:createSupabaseAdminClient(),token:process.env.NOTION_TOKEN??process.env.NOTION_API_KEY}));}
 catch{return staffResponse({error:'school_context_sync_failed'},undefined,503);}
}
