import {InterviewError} from './interview-core.mjs';
import {BENSUKE_SOURCE,staffDirectory,teacherMatch,checkedPage} from './bensuke-booking.mjs';
import {validInterviewDate,interviewDateParts} from './survey-workflow-core.mjs';
import {surveyScheduleStyle,scheduleMethods} from './survey-schedule-style.mjs';
import {matchingSurveyAvailability,archiveSurveyAvailability} from './survey-bensuke-availability.mjs';

const plain=items=>(items??[]).map(x=>x.plain_text??x.text?.content??'').join('');
const marker=id=>`勉たん面談アンケート:${id.replaceAll('-','').toLowerCase()}`;
export async function activeSurveySchedule(request,pageId){
 if(!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(pageId))throw new InterviewError('ベンスケのカードを選び直してください。',409);
 const page=await request(`/pages/${pageId}`);
 if(String(page.parent?.data_source_id).replaceAll('-','').toLowerCase()!==BENSUKE_SOURCE.replaceAll('-',''))throw new InterviewError('別のDBのカードは使用できません。',409);
 return page.archived||page.in_trash?null:page;
}
export function surveyScheduleValue(page){
 const p=page.properties??{};
 if(p['担当者']?.has_more)throw new InterviewError('ベンスケの担当者を全件確認できません。',409);
 return {title:plain(p['名前']?.title),start:p['日時']?.date?.start??'',end:p['日時']?.date?.end??null,
  teachers:(p['担当者']?.relation??[]).map(x=>x.id).sort(),tags:(p['内容']?.multi_select??[]).map(x=>x.name).sort(),note:plain(p['備考']?.rich_text),campuses:(p['校舎']?.multi_select??[]).map(x=>x.name).sort()};
}
export function sameSurveySchedule(a,b){
 const canon=v=>v?{title:v.title,start:v.start.includes('T')?new Date(v.start).toISOString():v.start,
  end:v.end?.includes('T')?new Date(v.end).toISOString():v.end,teachers:[...v.teachers].sort(),tags:[...v.tags].sort(),note:v.note}:null;
 return JSON.stringify(canon(a))===JSON.stringify(canon(b));
}
function properties(v,writeCampus=true){return {'名前':{title:[{text:{content:v.title}}]},'日時':{date:{start:v.start,end:v.end}},
 '担当者':{relation:v.teachers.map(id=>({id}))},'内容':{multi_select:v.tags.map(name=>({name}))},'備考':{rich_text:[{text:{content:v.note}}]},...(writeCampus&&v.campuses.length?{'校舎':{multi_select:v.campuses.map(name=>({name}))}}:{})};}

/** One durable lease covers both Notion writes. An ambiguous create is never repeated. */
export async function saveSurveySchedule({request,claim,store,reserve,resolveCampus,answer,student,date,time='',endTime='',method='３者Zoom',expectedEditedAt}){
 if(!validInterviewDate(date)||typeof time!=='string'||time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new InterviewError('面談日時を確認してください。',400);
 if(typeof endTime!=='string'||endTime&&(!time||!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)||endTime<=time))throw new InterviewError('終了時刻は開始時刻より後にしてください。',400);
 if(!scheduleMethods.includes(method))throw new InterviewError('面談方法を確認してください。',400);
 const start=time?`${date}T${time}:00+09:00`:date;
 const link=await claim(answer.id);
 const persist=async(value,release=false)=>{await store(answer.id,link.lease,value,release);Object.assign(link,value);};
 try{
  // Re-read under the lease rather than relying on the page loaded before it.
  const fresh=await request(`/pages/${answer.id}`),current=fresh.properties?.['面談日']?.date?.start??'';
  const sameDate=JSON.stringify(interviewDateParts(current))===JSON.stringify({date,time});
  if(fresh.last_edited_time!==expectedEditedAt&&!sameDate)throw new InterviewError('アンケートが更新されています。読み込み直して確認してください。',409);
  const schema=await request(`/data_sources/${BENSUKE_SOURCE}`);
  const style=surveyScheduleStyle(student,method);
  if(schema.properties?.['備考']?.type!=='rich_text'||!schema.properties?.['内容']?.multi_select?.options?.some(x=>x.name===style.tag))throw new InterviewError('ベンスケの備考・面談分類の設定を確認してください。',503);
  const teacherName=String(student.homeroom_teacher??'').trim();
  const teacher=teacherName&&teacherName!=='未設定'?teacherMatch(teacherName,await staffDirectory(request,schema)):null;
  const campus=resolveCampus?null:['本校','南教室'].includes(student.campus)?student.campus:null;
  const desired={title:style.title,start,end:endTime?`${date}T${endTime}:00+09:00`:null,teachers:teacher?[teacher.id]:[],tags:[style.tag],note:marker(answer.id),campuses:campus?[campus]:[]};
  let page=link.page_id?await activeSurveySchedule(request,link.page_id):null;
  // A trashed appointment is no longer a schedule. Release its stale link
  // under the answer lease, then use the current availability/new-save flow.
  if(link.page_id&&!page)await persist({page_id:null,baseline:null,state:'new'});
  const inferCampus=resolveCampus?()=>resolveCampus(date,teacherName):undefined;
  const slot=await matchingSurveyAvailability(request,desired,link.page_id,inferCampus);
  if(slot){
   if(!reserve)throw new InterviewError('予約可の保存準備ができません。再試行してください。',503);
   desired.campuses=slot.value.campuses;
   desired.end??=slot.value.end;
  }
  else if(inferCampus&&(!page||Date.parse(surveyScheduleValue(page).start)!==Date.parse(desired.start)||!surveyScheduleValue(page).campuses.length)){const inferred=await inferCampus();desired.campuses=inferred?[inferred]:[];}
  if(!link.page_id){
   const found=await request(`/data_sources/${BENSUKE_SOURCE}/query`,{method:'POST',body:JSON.stringify({page_size:100,filter:{property:'備考',rich_text:{contains:marker(answer.id)}}})});
   if(!Array.isArray(found.results)||found.has_more)throw new InterviewError('対応するベンスケの予定を一つに確認できません。',409);
   const active=found.results.filter(row=>!row.archived&&!row.in_trash);
   if(active.length>1)throw new InterviewError('対応するベンスケの予定を一つに確認できません。',409);
   if(active.length){
    page=await checkedPage(request,active[0].id,BENSUKE_SOURCE);
    if(!link.expected||!sameSurveySchedule(surveyScheduleValue(page),link.expected))throw new InterviewError('ベンスケの予定が変更されています。原本を確認してください。',409);
    await persist({page_id:page.id,baseline:surveyScheduleValue(page),state:'saved'});
   }else{
    if(link.state==='creating')throw new InterviewError('ベンスケへの登録結果が未確認です。重複を防ぐため再作成を停止しています。時間を置いて再試行してください。',409);
    if(slot){
     await reserve(answer.id,link.lease,slot.page.id);
     page=slot.page;
     await persist({page_id:page.id,baseline:slot.value,expected:desired,state:'updating'});
    }else{
    await persist({expected:desired,state:'creating'});
    page=await request('/pages',{method:'POST',body:JSON.stringify({parent:{type:'data_source_id',data_source_id:BENSUKE_SOURCE},properties:properties(desired)})});
    page=await checkedPage(request,page.id,BENSUKE_SOURCE);
    if(!sameSurveySchedule(surveyScheduleValue(page),desired))throw new InterviewError('ベンスケの登録内容を確認できません。再試行で確認してください。',409);
    await persist({page_id:page.id,baseline:surveyScheduleValue(page),state:'saved'});
    }
   }
  }
  let remote=surveyScheduleValue(page);
  if(!endTime&&remote.start.includes('T')&&Date.parse(remote.start)===Date.parse(desired.start))desired.end=remote.end??link.expected?.end??desired.end;
  if(!slot&&remote.campuses.length&&remote.start===desired.start)desired.campuses=remote.campuses;
  else if(!slot&&!desired.campuses.length&&remote.campuses.length)desired.campuses=remote.campuses;
  const oldNote=remote.note.split('\n').filter(line=>line!==marker(answer.id)).join('\n');
  desired.note=oldNote?`${oldNote}\n${marker(answer.id)}`:marker(answer.id);
  if(!sameSurveySchedule(remote,link.baseline)&&!(link.state==='updating'&&sameSurveySchedule(remote,link.expected)))throw new InterviewError('ベンスケ側で予定が変更されています。原本を確認してください。',409);
  if(slot&&slot.page.id!==page.id)await reserve(answer.id,link.lease,slot.page.id);
  for(const duplicate of slot?.duplicates??[])await reserve(answer.id,link.lease,duplicate.page.id);
  const campusChanged=JSON.stringify(remote.campuses)!==JSON.stringify(desired.campuses);
  if(!sameSurveySchedule(remote,desired)||campusChanged){
   await persist({expected:desired,state:'updating'});
   const before=await checkedPage(request,page.id,BENSUKE_SOURCE);
   if(!sameSurveySchedule(surveyScheduleValue(before),remote)||before.last_edited_time!==page.last_edited_time)throw new InterviewError('保存中にベンスケが更新されました。原本を確認してください。',409);
   await request(`/pages/${page.id}`,{method:'PATCH',body:JSON.stringify({properties:properties(desired,campusChanged)})});
   page=await checkedPage(request,page.id,BENSUKE_SOURCE);remote=surveyScheduleValue(page);
   if(!sameSurveySchedule(remote,desired)||JSON.stringify(remote.campuses)!==JSON.stringify(desired.campuses))throw new InterviewError('ベンスケの反映結果を確認できません。再試行してください。',409);
  }
  await persist({page_id:page.id,baseline:remote,expected:desired,state:'saved'});
  // Existing linked appointments keep their URL. Remove only the verified
  // matching availability after the appointment is durably saved.
  if(slot&&slot.page.id!==page.id)await archiveSurveyAvailability({request,reserve,answerId:answer.id,lease:link.lease,slot});
  for(const duplicate of slot?.duplicates??[])await archiveSurveyAvailability({request,reserve,answerId:answer.id,lease:link.lease,slot:duplicate});
  const latest=await request(`/pages/${answer.id}`);
  if(latest.last_edited_time!==fresh.last_edited_time&&JSON.stringify(interviewDateParts(latest.properties?.['面談日']?.date?.start??''))!==JSON.stringify({date,time}))throw new InterviewError('ベンスケは保存しましたが、アンケートが更新されたため面談日の変更を停止しました。最新情報を確認してください。',409);
  if(!sameDate)await request(`/pages/${answer.id}`,{method:'PATCH',body:JSON.stringify({properties:{'面談日':{date:{start}}}})});
  await persist({state:'synced'},true);
  return {ok:true,date,bensuke:{id:page.id,url:page.url??`https://www.notion.so/${page.id.replaceAll('-','')}`,state:'synced',method,endTime:interviewDateParts(remote.end??'').time,styled:true}};
 }catch(error){
  await persist({},true).catch(()=>{});
  if(error instanceof InterviewError)throw error;
  throw new InterviewError('面談日の保存を完了できませんでした。入力を保持しています。同じ保存ボタンで反映結果を確認・再試行してください。',503);
 }
}
