import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {notionRequest} from './notion';
import {syncBookingToNotion} from './interview-notion.mjs';
import {InterviewError} from './interview-core.mjs';
export async function syncInterview(db:SupabaseClient,id:string){
 const {data:settings,error}=await db.from('interview_settings').select('notion_source_id').eq('id',true).single();
 if(error||!settings?.notion_source_id)return {status:'unavailable',message:'面談は保存しました。Notionの面談予定DBが未接続のため、Notion反映は保留しています。'};
 const claim=await db.rpc('interview_sync_claim',{p_id:id});
 if(claim.error)throw new InterviewError('同期を開始できませんでした。面談の保存内容は保持しています。',503);
 if(!claim.data)return {status:'waiting',message:'反映済み、承認待ち、または同期処理中です。'};
 let result;
 try{result=await syncBookingToNotion({booking:claim.data,sourceId:settings.notion_source_id,request:notionRequest});}
 catch(e){result={status:'review',message:e instanceof InterviewError?e.message:'Notionへ接続できませんでした。面談の保存内容は保持しています。'};}
 const finished=await db.rpc('interview_sync_finish',{p_id:id,p_lease:claim.data.lease,p_result:result});
 if(finished.error)throw new InterviewError('同期結果の保存を確認できません。再試行前に管理者へお知らせください。',503);
 return {status:result.status,message:result.status==='synced'?'Notionに反映しました。':result.message};
}
