import {INTERVIEW_SURVEY_PROPERTY_ORDER} from './interview-survey-property-order.mjs';

export const invitationProgressLabels = {
 new:'未打診', waiting:'回答待ち', pending:'承認待ち', confirmed:'確定',
 completed:'実施済み', rearrange:'再調整', delivery:'送信要確認',
};
/** @returns {'new'|'waiting'|'pending'|'confirmed'|'completed'|'rearrange'|'delivery'} */
export function invitationProgress(invitation, now=Date.now()) {
 if(!invitation)return 'new';
 if(invitation.answerStatus==='confirmed')return 'confirmed';
 if(invitation.answerStatus==='completed')return 'completed';
 if(invitation.answerStatus==='pending'&&invitation.status==='active')return 'pending';
 if(invitation.status!=='active'||['rejected','cancelled'].includes(invitation.answerStatus)||Date.parse(invitation.expires_at)<=now)return 'rearrange';
 return invitation.notification_status==='sent'?'waiting':'delivery';
}
export function currentInvitation(invitations,studentId){
 const rows=invitations.filter(i=>i.student_id===studentId).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 return rows.find(i=>['confirmed','completed'].includes(i.answerStatus)||i.status==='active')??rows[0];
}
export function blocksNewInvitation(invitation,now=Date.now()){
 return !!invitation&&(invitation.answerStatus==='pending'||invitation.answerStatus==='confirmed'||invitation.status==='active'&&Date.parse(invitation.expires_at)>now);
}
export function defaultInvitationTeacher(staff,students){
 const key=s=>String(s??'').normalize('NFKC').replace(/[\s　]/g,'').replace(/(?:先生|さん)$/u,'').replace(/高山/g,'髙山');
 const names=[...new Set(students.map(s=>s.teacher).filter(Boolean))];
 const display=key(staff?.displayName);
 const exact=names.find(n=>key(n)===display);
 if(exact)return exact;
 const matches=display?names.filter(n=>display.startsWith(key(n))):[];
 return matches.length===1?matches[0]:'';
}
// Property values only; relations, formulas and rollups can contain unrelated internal data.
export function surveyAnswerFields(properties,grade=''){
 const order=INTERVIEW_SURVEY_PROPERTY_ORDER[String(grade??'').normalize('NFKC')]??[];
 const positions=new Map(order.map((id,index)=>[id,index]));
 return Object.entries(properties??{}).flatMap(([label,p],sourceIndex)=>{
  if(!p||['relation','rollup','formula','people','files','created_by','last_edited_by'].includes(p.type))return [];
  const id=p.id?decodeURIComponent(p.id):'';
  if(order.length&&!positions.has(id))return [];
  if(!order.length&&(p.type==='title'||label==='学籍番号'))return [];
  if(['担任','所属','状態','年度','備考','面談準備','面談日','対応'].includes(label))return [];
  let value='';
  if(p.type==='title')value=(p.title??[]).map(t=>t.plain_text??t.text?.content??'').join('');
  else if(p.type==='rich_text')value=(p.rich_text??[]).map(t=>t.plain_text??t.text?.content??'').join('');
  else if(p.type==='select'||p.type==='status')value=p[p.type]?.name??'';
  else if(p.type==='multi_select')value=(p.multi_select??[]).map(s=>s.name).join('、');
  else if(p.type==='checkbox')value=p.checkbox?'はい':'いいえ';
  else if(p.type==='number'&&p.number!=null)value=String(p.number);
  else if(p.type==='date')value=[p.date?.start,p.date?.end].filter(Boolean).join(' 〜 ');
  return value?[{label,value,position:positions.get(id)??Infinity,sourceIndex}]:[];
 }).sort((a,b)=>a.position-b.position||a.sourceIndex-b.sourceIndex)
  .map(({label,value})=>({label,value}));
}
