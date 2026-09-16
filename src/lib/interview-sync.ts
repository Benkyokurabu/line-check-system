import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {notionRequest} from './notion';
import {syncBensukeBooking} from './bensuke-sync.mjs';
import {InterviewError} from './interview-core.mjs';
import {conflicts} from './interview-core.mjs';
import {loadInterviewState} from './interview-store';
export const bensukeRequest=(path:string,init:RequestInit={})=>notionRequest(path,{...init,cache:'no-store',signal:AbortSignal.timeout(8000)});
export async function syncInterview(db:SupabaseClient,id:string){
 const {data:settings,error}=await db.from('interview_settings').select('notion_source_id').eq('id',true).single();
 if(error||!settings?.notion_source_id)return {status:'unavailable',message:'面談は保存しました。Notionの面談予定DBが未接続のため、Notion反映は保留しています。'};
 const claim=await db.rpc('interview_sync_claim',{p_id:id});
 if(claim.error)throw new InterviewError('同期を開始できませんでした。面談の保存内容は保持しています。',503);
 if(!claim.data)return {status:'waiting',message:'反映済み・承認待ち・同期処理中、またはベンスケの予約可と未連携の予定です。'};
 let result;
 try{
  if(!['cancelled','rejected'].includes(claim.data.status)){
   const state=await loadInterviewState(db);
   const reasons=conflicts({...claim.data.data,id},state.lessons,state.bookings);
   if(reasons.length)throw new InterviewError(reasons.join('。'),409);
  }
  result=await syncBensukeBooking({booking:claim.data,sourceId:settings.notion_source_id,request:bensukeRequest,
   stage:async(value:unknown)=>{const staged=await db.rpc('interview_bensuke_stage',{p_id:id,p_lease:claim.data.lease,p_expected:value});if(staged.error)throw new InterviewError('同期の版が変わりました。再確認してください。',409);}});
 }
 catch(e){result={status:'review',message:e instanceof InterviewError?e.message:'Notionへ接続できませんでした。面談の保存内容は保持しています。'};}
 const finished=await db.rpc('interview_sync_finish',{p_id:id,p_lease:claim.data.lease,p_result:result});
 if(finished.error)throw new InterviewError('同期結果の保存を確認できません。再試行前に管理者へお知らせください。',503);
 return {status:result.status,message:result.status==='synced'?'Notionに反映しました。':('message' in result?result.message:'Notionの反映結果を確認してください。')};
}
