import {InterviewError} from './interview-core.mjs';
import {BENSUKE_SOURCE,queryPages,checkedPage} from './bensuke-booking.mjs';
import {surveyScheduleValue,sameSurveySchedule,activeSurveySchedule} from './survey-bensuke.mjs';

const availabilityTags=['本：予約可','南：予約可'];
const instant=value=>value?.includes('T')?Date.parse(value):NaN;
// Renaming a cleared appointment to exactly "予約可" is an explicit reopening.
// Never infer availability from an occupied card that still names a student or
// carries another survey's linkage marker.
export function explicitlyReopenedAvailability(value){
 return value.title.normalize('NFKC').trim()==='予約可'&&value.tags.length===1&&
  ['面談(オンライン)','面談(対面)','面談予定','電話'].includes(value.tags[0])&&!value.note.includes('勉たん面談アンケート:');
}

// Match the actual assigned teacher and start instant. The slot's campus is
// authoritative: a student's usual campus does not determine the meeting room.
export async function matchingSurveyAvailability(request,desired,excludeId,resolveCampus){
 if(!desired.start.includes('T')||desired.teachers.length!==1)return null;
 const rows=await queryPages(request,BENSUKE_SOURCE,{and:[
  {property:'日時',date:{equals:desired.start.slice(0,10)}},
  {property:'担当者',relation:{contains:desired.teachers[0]}},
  {or:[...availabilityTags.map(tag=>({property:'内容',multi_select:{contains:tag}})),{property:'名前',title:{equals:'予約可'}}]},
 ]});
 let matches=rows.filter(page=>page.id!==excludeId&&instant(page.properties?.['日時']?.date?.start)===instant(desired.start));
 if(matches.length>1&&new Set(matches.map(p=>JSON.stringify(surveyScheduleValue(p).campuses))).size>1&&resolveCampus){
  const campus=await resolveCampus();if(campus)matches=matches.filter(p=>surveyScheduleValue(p).campuses.includes(campus));
 }
 if(!matches.length)return null;
 const slots=[];
 for(const match of matches){
 const page=await checkedPage(request,match.id,BENSUKE_SOURCE),value=surveyScheduleValue(page);
 const tag=value.tags[0],reopened=explicitlyReopenedAvailability(value),campus=reopened?value.campuses[0]:tag==='本：予約可'?'本校':'南教室';
 if(value.tags.length!==1||!availabilityTags.includes(tag)&&!reopened||value.teachers.length!==1||value.teachers[0]!==desired.teachers[0]||value.campuses.length!==1||!['本校','南教室'].includes(campus)||value.campuses[0]!==campus||instant(value.start)!==instant(desired.start))
  throw new InterviewError('予約可に別の用途・担当者・校舎が設定されています。ベンスケの原本を確認してください。',409);
 if(value.end&&(!Number.isFinite(instant(value.end))||instant(value.end)<=instant(value.start))||desired.end&&value.end&&instant(desired.end)>instant(value.end))
  throw new InterviewError('面談の終了時刻が予約可の枠を超えています。日時を確認してください。',409);
 slots.push({page,value});
 }
 const key=slot=>JSON.stringify([slot.value.campuses,instant(slot.value.end)||null,slot.page.properties?.['教室']?.select?.name??'']);
 if(new Set(slots.map(key)).size>1)throw new InterviewError('同じ担当者・開始時刻の予約可の校舎・教室・終了が一致しません。ベンスケの原本を確認してください。',409);
 slots.sort((a,b)=>a.page.id.localeCompare(b.page.id));
 return {...slots[0],duplicates:slots.slice(1)};
}

export async function archiveSurveyAvailability({request,reserve,answerId,lease,slot}){
 await reserve(answerId,lease,slot.page.id);
 const before=await checkedPage(request,slot.page.id,BENSUKE_SOURCE);
 if(!sameSurveySchedule(surveyScheduleValue(before),slot.value)||JSON.stringify(surveyScheduleValue(before).campuses)!==JSON.stringify(slot.value.campuses)||before.last_edited_time!==slot.page.last_edited_time)
  throw new InterviewError('保存中に予約可が更新されました。ベンスケの原本を確認してください。',409);
 await request(`/pages/${slot.page.id}`,{method:'PATCH',body:JSON.stringify({archived:true})});
 const after=await request(`/pages/${slot.page.id}`);
 if(!after.archived&&!after.in_trash)throw new InterviewError('予約可の重複解消を確認できません。同じ保存ボタンで再試行してください。',503);
}

// A transfer keeps the original availability URL. Its displaced appointment
// is retired only after the replacement and the link are durably verified.
export async function archiveReplacedSurveySchedule(request,replaced){
 const before=await activeSurveySchedule(request,replaced.id);
 if(!before)return;
 const value=surveyScheduleValue(before);
 if(!sameSurveySchedule(value,replaced.value)||JSON.stringify(value.campuses)!==JSON.stringify(replaced.value.campuses)||before.last_edited_time!==replaced.editedAt)
  throw new InterviewError('付け替え前の面談が変更されています。重複した原本を確認してください。',409);
 await request(`/pages/${replaced.id}`,{method:'PATCH',body:JSON.stringify({archived:true})});
 const after=await request(`/pages/${replaced.id}`);
 if(!after.archived&&!after.in_trash)throw new InterviewError('付け替え前の面談の整理を確認できません。同じ保存ボタンで再試行してください。',503);
}
