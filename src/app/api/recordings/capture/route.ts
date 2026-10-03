import {NextRequest,NextResponse} from 'next/server';
import {createSupabaseAdminClient} from '@/lib/supabase';
import {automaticTestRules} from '@/lib/recording-notion';
import {validRecordingKey} from '@/lib/recording-publication.mjs';
import {recordingPublisherAllowed} from '@/lib/recording-publisher';
export const dynamic='force-dynamic';
export const maxDuration=60;
// Publishers already have permission to push the public calendar repository.
// Verify that permission before accepting original URLs into private storage.
export async function POST(request:NextRequest){
 try{
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
  if(!token)return NextResponse.json({error:'Publisher authentication required.'},{status:401});
  if(!await recordingPublisherAllowed(token))return NextResponse.json({error:'Calendar publisher permission required.'},{status:403});
  const input=await request.json();
  if(!Array.isArray(input.recordings)||input.recordings.length>100)return NextResponse.json({error:'Invalid recording list.'},{status:400});
  const rules=await automaticTestRules(),db=createSupabaseAdminClient();
  let captured=0;
  for(const recording of input.recordings){
   if(!validRecordingKey(recording.key)||typeof recording.url!=='string'||!recording.url.startsWith('https://')||recording.url.length>4096)return NextResponse.json({error:'Invalid recording.'},{status:400});
   const fields=recording.key.split('|');
   const rule=rules.find(r=>r.match.date===fields[0]&&r.match.campus===fields[2]&&r.match.group===fields[3]);
   if(!rule)continue;
   const result=await db.rpc('capture_test_recording',{p_key:recording.key,p_url:recording.url,p_lesson:recording.lesson ?? {},p_notion_page_id:rule.notionPageId});
   if(result.error)return NextResponse.json({error:'Private recording storage failed.'},{status:503});
   captured++;
  }
  return NextResponse.json({captured},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Recording capture unavailable.'},{status:503});}
}
