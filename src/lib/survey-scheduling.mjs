import {INTERVIEW_SURVEY_CAMPAIGN} from './interview-survey-campaign.mjs';
export const schedulingLabels={uncontacted:'未連絡',invited:'打診済み',confirmed:'面談日確定',unknown:'要確認'};
export function surveyScheduling(studentId,invitations,requests,bookings,now=Date.now()){
 if(!studentId)return {status:'unknown',detail:'生徒の紐づけを確認してください。'};
 const all=invitations.filter(i=>i.student_id===studentId);
 const rows=all.filter(i=>i.slots?.some(s=>s.surveyCampaign?.id===INTERVIEW_SURVEY_CAMPAIGN.id)).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const answers=requests.filter(r=>rows.some(i=>i.id===r.invitation_id));
 const fixed=bookings.filter(b=>['confirmed','completed'].includes(b.status)&&answers.some(r=>r.booking_id===b.id)).sort((a,b)=>String(a.data.date).localeCompare(String(b.data.date)))[0];
 if(fixed)return {status:'confirmed',detail:fixed.status==='completed'?'実施済み':'日程が確定しています。',date:fixed.data.date,start:fixed.data.start,end:fixed.data.end};
 const invitation=rows.find(i=>i.status==='active'&&Date.parse(i.expires_at)>now)??rows[0];
 if(!invitation){
  // Legacy or manually entered records have no campaign identity. Do not guess.
  if(all.some(i=>!i.slots?.some(s=>s.surveyCampaign?.id))||bookings.some(b=>b.data?.studentId===studentId&&['confirmed','pending'].includes(b.status)&&!requests.some(r=>r.booking_id===b.id)))return {status:'unknown',detail:'アンケートとの紐づけがない面談記録があります。'};
  return {status:'uncontacted',detail:'日程の打診はまだありません。'};
 }
 const answer=answers.filter(r=>r.invitation_id===invitation.id).sort((a,b)=>String(b.created_at??'').localeCompare(String(a.created_at??'')))[0];
 const sent=invitation.notification_status==='sent'||!!invitation.sent_at||!!answer;
 const status=sent?'invited':'uncontacted';
 if(invitation.status!=='active')return {status,detail:invitation.status==='declined'?'日程が合わない・再調整が必要です。':'打診取消・再調整が必要です。'};
 if(answer?.status==='pending')return {status:'invited',detail:'返信あり・先生の承認待ち'};
 if(answer&&['rejected','cancelled','approved'].includes(answer.status))return {status,detail:'取消・再調整が必要です。'};
 if(Date.parse(invitation.expires_at)<=now)return {status,detail:'回答期限切れ・再調整が必要です。'};
 if(sent)return {status:'invited',detail:'返信待ち'};
 return {status:'uncontacted',detail:['sending','pending'].includes(invitation.notification_status)?'打診の送信処理中':'送信要確認・まだ打診済みではありません。'};
}
