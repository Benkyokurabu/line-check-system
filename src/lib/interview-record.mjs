import {InterviewError,minutes} from './interview-core.mjs';
import {isValidReservationDate,getJapanDate} from './reservation-date.mjs';

export const recordTextFields=[
 ['content','面談内容',5000],['decisions','決定事項',3000],
 ['staffTasks','職員が対応すること',3000],['familyRequests','本人・家庭への依頼',3000],['memo','自由メモ',3000],
];
// Versioned form values stay with the record. Scheduled facts remain on the booking.
export function makeRecordDraft(appointment){
 const saved=appointment.record??{};
 const value=(key,fallback='')=>String(saved[key]??fallback);
 return {schemaVersion:1,content:value('content'),decisions:value('decisions'),staffTasks:value('staffTasks'),
  familyRequests:value('familyRequests'),memo:value('memo'),nextReviewDate:value('nextReviewDate'),
  actualDate:value('actualDate',appointment.date),actualStart:value('actualStart',appointment.start),
  actualEnd:value('actualEnd',appointment.end??''),actualParticipants:value('actualParticipants',appointment.participants),
  purpose:value('purpose',appointment.purpose),state:value('state','draft')};
}
export function validateRecord(input,appointment,action,today=getJapanDate()){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new InterviewError('面談記録を確認してください。');
 const record=makeRecordDraft(appointment);
 for(const [key,,max] of [...recordTextFields,['actualParticipants','',500],['purpose','',500],
  ['actualDate','',10],['actualStart','',5],['actualEnd','',5],['nextReviewDate','',10]]){
  const value=input[key]??record[key];
  if(typeof value!=='string'||value.length>max)throw new InterviewError('記録の文字数・形式を確認してください。');
  record[key]=value.trim();
 }
 record.state=action==='complete'?'draft':input.state;
 if(!['draft','final'].includes(record.state))throw new InterviewError('記録の保存方法を選択してください。');
 if(!isValidReservationDate(record.actualDate)||record.actualDate>today)throw new InterviewError('実施日は今日以前の日付を入力してください。');
 if((record.actualStart&&record.actualEnd&&minutes(record.actualStart)>=minutes(record.actualEnd))
  || (!!record.actualStart!==!!record.actualEnd))throw new InterviewError('実際の開始・終了時刻を確認してください。');
 if(record.actualStart)minutes(record.actualStart);
 if(record.actualEnd)minutes(record.actualEnd);
 if(record.nextReviewDate&&!isValidReservationDate(record.nextReviewDate))throw new InterviewError('次回確認日を確認してください。');
 if(record.state==='final'&&(!record.content||!record.actualStart||!record.actualEnd||!record.actualParticipants||!record.purpose))
  throw new InterviewError('確定するには面談内容・実際の時刻・参加者・目的を入力してください。');
 return record;
}
