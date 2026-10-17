import {randomUUID} from 'node:crypto';
import {InterviewError} from './interview-core.mjs';
import {isValidReservationDate} from './reservation-date.mjs';
import {digest,isEnrollmentId,propertyText} from './enrollment-core.mjs';
export {digest};
export const RECORD_SOURCE='19ef0120-80a7-808a-8992-000b85713577';
export const postFields=[
 {key:'title',label:'面談の見出し',type:'text',property:'面談内容'},
 {key:'date',label:'実施日',type:'date',property:'面談日'},
 {key:'method',label:'実際の面談方法',type:'select',property:'方法'},
 {key:'grade',label:'面談時の学年',type:'select',property:'面談時の学年'},
 {key:'purpose',label:'面談目的',type:'multi',property:'面談目的'},
 {key:'author',label:'記入者',type:'staff',property:'記入者'},
 {key:'record',label:'職員用の面談記録',type:'long'},
 {key:'summary',label:'本人・保護者へ共有する内容',type:'long'},
 {key:'handling',label:'アンケートの対応',type:'select',options:['対応済','未着手','不要']},
];
export const canUsePostInterview=staff=>!!staff?.staffId&&staff.staffCode==='KUDO'&&['admin','office','employee'].includes(staff.role);
export function assertPostInterview(staff){if(!canUsePostInterview(staff))throw new InterviewError('面談後の一括入力は工藤先生の確認中です。',403);}
export function postAnswerRows(rows,roster,query=''){const names=new Map(roster.map(s=>[String(s.student_number),s]));const normalize=value=>String(value??'').normalize('NFKC').replace(/\s/g,'');const q=normalize(query);return rows.filter(r=>r.link_status==='linked').flatMap(r=>{const student=names.get(String(r.student_number));if(!student||q&&!normalize(student.student_name).includes(q))return [];return [{id:r.page_id,name:student.student_name,grade:student.grade,date:r.appointment_date??'',number:r.student_number}];}).slice(0,80);}
export const blankPostFields=()=>Object.fromEntries(postFields.map(f=>[f.key,{value:'',state:'unknown',source:'',reason:'未確認',candidates:[]}]));
export const confirmed=(payload,key)=>payload.fields[key]?.state==='confirmed'?payload.fields[key].value:'';
export function validatePostPayload(input){
 if(!input||!isEnrollmentId(input.answerId)||!isEnrollmentId(input.studentPageId)||input.recordPageId&&!isEnrollmentId(input.recordPageId))throw new InterviewError('対象の生徒・回答・記録を選び直してください。',422);
 const fields=blankPostFields();
 for(const def of postFields){const field=input.fields?.[def.key];if(!field||!['unknown','review','confirmed','not_applicable'].includes(field.state)||typeof field.value!=='string'||field.value.length>(['record','summary'].includes(def.key)?15000:1000))throw new InterviewError('入力と判断の状態を確認してください。',422);
  fields[def.key]={value:field.value.trim(),state:field.state,source:String(field.source??'').slice(0,2000),reason:String(field.reason??'').slice(0,1000),candidates:Array.isArray(field.candidates)?field.candidates.filter(x=>typeof x==='string').slice(0,10).map(x=>x.slice(0,500)):[]};
  if(field.state==='confirmed'&&!fields[def.key].value)throw new InterviewError(`「${def.label}」の値を入力するか、未確認にしてください。`,422);
 }
 if(fields.date.state==='confirmed'&&!isValidReservationDate(fields.date.value))throw new InterviewError('実施日を確認してください。',422);
 if(fields.author.state==='confirmed'&&!isEnrollmentId(fields.author.value))throw new InterviewError('記入者を選択してください。',422);
 if(typeof input.sourceText!=='string'||input.sourceText.length>40000)throw new InterviewError('原文は40000文字以内にしてください。',422);
 return {answerId:input.answerId,studentPageId:input.studentPageId,recordPageId:input.recordPageId??'',fields,sourceText:input.sourceText,participants:String(input.participants??'').slice(0,1000)};
}
export function seedPostFields({record,survey,recordText='',grade='',method='',author=''}){
 const fields=blankPostFields();const set=(key,value,state,source)=>{if(value)fields[key]={value,state,source,reason:state==='review'?'予定・候補です。実際の内容を確認してください。':'',candidates:[]};};
 if(record){for(const def of postFields.filter(d=>d.property)){const p=record.properties[def.property];set(def.key,def.key==='author'?p?.relation?.length===1?p.relation[0].id:'':propertyText(p),'confirmed','既存の面談記録');}set('record',recordText,'confirmed','既存の面談本文');}
 else{set('date',propertyText(survey.properties['面談日']),'review','アンケートの予定日');set('grade',grade.normalize('NFKC').replace(/[0-9]/g,c=>'０１２３４５６７８９'[Number(c)]),'review','現在の学年（面談当時か確認）');set('method',method,'review','予約時の予定');set('author',author,'review','ログイン者に対応する職員（記入者か確認）');}
 // Do not turn an existing completion flag into a new instruction to write it.
 set('handling',propertyText(survey.properties['対応']),'review','既存の対応状況（今回の変更要否を確認）');return fields;
}
export function checkedPostAI(result,sourceText){
 const candidate=result?.fields??result;const fields={};for(const def of postFields){if(['author','handling'].includes(def.key))continue;const row=candidate?.[def.key];if(!row||typeof row.value!=='string')continue;const source=typeof row.source==='string'&&sourceText.includes(row.source)?row.source:'';fields[def.key]={value:row.value.slice(0,['record','summary'].includes(def.key)?15000:1000),state:'review',source,reason:source?'AI候補です。原文を確認してください。':'根拠の箇所を確認できません。人の判断が必要です。',candidates:[]};}return {fields};
}
export function planPostDelivery({previous={},approval,accounts,summary,entryId}){
 const result=structuredClone(previous);if(!approval)return result;
 if(!summary)throw new InterviewError('共有内容を確定してから、宛先と本文を確認してください。',422);
 if(!Array.isArray(approval)||!approval.length||approval.length>10)throw new InterviewError('確認した送信先を選んでください。',422);
 const seen=new Set();for(const item of approval){const account=accounts.find(a=>a.id===item.id);if(!account||account.verification!=='confirmed'||account.category==='unknown'||seen.has(item.id))throw new InterviewError('本人・続柄を確認済みの送信先だけを選んでください。',422);seen.add(item.id);
  if(typeof item.text!=='string'||!item.text.trim()||item.text.length>5000)throw new InterviewError('宛先ごとのLINE本文を確認してください。',422);
  const text=item.text.trim(),hash=digest({entryId,id:item.id,text});const old=previous[item.id];
  if(old&&['sending','unknown'].includes(old.status)&&!(item.external===true&&text===old.text))throw new InterviewError('結果不明の送信先があります。履歴を確認するまで新しい文面は送信できません。',409);
  if(old?.hash===hash&&['accepted','external'].includes(old.status))continue;
  if(old&&['accepted','external'].includes(old.status)&&item.confirmResend!==true)throw new InterviewError('この宛先には送信済みです。追加送信する場合は再送の確認をしてください。',409);
  const external=typeof item.externalNote==='string'?item.externalNote.trim():'';
  if(item.external===true&&external.length<4)throw new InterviewError('外部で送信済みの根拠（日時・宛先など）を入力してください。',422);
  result[item.id]={id:item.id,label:account.label,text,hash,key:old?.hash===hash?old.key:randomUUID(),status:item.external?'external':'pending',externalNote:external,approvedAt:new Date().toISOString(),error:''};
 }return result;
}
