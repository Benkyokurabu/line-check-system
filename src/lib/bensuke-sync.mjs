import {InterviewError} from './interview-core.mjs';
import {checkedPage,scheduleValue,staffDirectory,teacherMatch,desiredSchedule,scheduleProperties,equivalentSchedule,checkNotionConflicts} from './bensuke-booking.mjs';

export async function syncBensukeBooking({booking,sourceId,request,stage}){
 const pageId=booking.notion_page_id;
 if(!pageId||!booking.notion_original)return {status:'unavailable',message:'ベンスケの「予約可」から登録した面談が連携対象です。'};
 const schema=await request(`/data_sources/${sourceId}`);
 let page=await checkedPage(request,pageId,sourceId),remote=scheduleValue(page,schema);
 const cancelled=['cancelled','rejected'].includes(booking.status);
 const teacher=cancelled?null:teacherMatch(booking.data.teacher,await staffDirectory(request,schema));
 const desired=desiredSchedule(booking,teacher?.id);
 const done=()=>({status:'synced',pageId,editedAt:page.last_edited_time,value:remote});
 // Recover a lost PATCH/SQL response using its durably staged content. Never create a card.
 if(booking.notion_expected&&equivalentSchedule(remote,booking.notion_expected)){
  if(equivalentSchedule(remote,desired))return done();
  return {status:'review',message:'前回の反映結果と現在の予約が異なります。差分を確認してください。'};
 }
 if(!equivalentSchedule(remote,booking.notion_baseline))return {status:'review',message:'Notion側で予定が変更されています。「Notionとの差分を確認」から確認してください。'};
 if(equivalentSchedule(remote,desired))return done();
 if(!cancelled)await checkNotionConflicts({request,sourceId,schema,data:booking.data,teacherId:teacher.id,excludeId:pageId});
 const properties=scheduleProperties(desired,schema);
 await stage(desired);
 // Re-read immediately before the write; unrelated page content is never submitted.
 page=await checkedPage(request,pageId,sourceId);
 if(!equivalentSchedule(scheduleValue(page,schema),remote)){await stage(null);return {status:'review',message:'確認中にNotionの予定が変更されました。上書きを停止しました。'};}
 try{await request(`/pages/${pageId}`,{method:'PATCH',body:JSON.stringify({properties})});}
 catch{return {status:'uncertain',message:'Notionの反映結果を確認できません。「Notionへ反映」で結果を再確認してください。'};}
 page=await checkedPage(request,pageId,sourceId);remote=scheduleValue(page,schema);
 if(!equivalentSchedule(remote,desired))throw new InterviewError('Notionの反映後に変更を検出しました。差分を確認してください。',409);
 return done();
}
