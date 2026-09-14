import {getJapanDate,isValidReservationDate} from './reservation-date.mjs';
import {minutes,clock,overlaps,InterviewError} from './interview-core.mjs';
import {assertInterviewAccess} from './interview-access.mjs';
const active=new Set(['approved','change_requested','cancel_requested']);
export function trialDay(offset,today=getJapanDate()){
 return new Date(Date.parse(`${today}T12:00:00+09:00`)+offset*86400000).toISOString().slice(0,10);
}
// Explicitly fictional published slots. This trial never reads real students or schedules.
export function interviewTrialSlots(today=getJapanDate()){
 const starts=['13:00','14:00',...Array.from({length:10},(_,n)=>clock(18*60+35+n*5)),'20:30','21:30'];
 return Array.from({length:31},(_,n)=>trialDay(n,today)).flatMap(date=>['本校','南教室'].flatMap(campus=>starts.map(start=>({
  id:`${date}|${campus}|${start}`,date,campus,start,end:clock(minutes(start)+45),teacher:`${campus}の確認用担任`,
  busyStart:start>='18:35'&&start<='19:20'?'18:35':start,busyEnd:start>='18:35'&&start<='19:20'?'20:05':clock(minutes(start)+60),
 }))));
}
function clash(a,b){return a.date===b.date&&a.teacher===b.teacher&&overlaps(minutes(a.busyStart),minutes(a.busyEnd),minutes(b.busyStart),minutes(b.busyEnd));}
function ownClash(a,b){return a.date===b.date&&overlaps(minutes(a.busyStart),minutes(a.busyEnd),minutes(b.busyStart),minutes(b.busyEnd));}
function occupied(slot,rows,except,subject){return rows.some(r=>r.id!==except&&active.has(r.status)&&r.confirmed&&(clash(slot,r.confirmed)||(r.studentCode===subject&&ownClash(slot,r.confirmed))));}
const studentNames={KUDO:'工藤（確認用生徒）',KINJO:'金城（確認用生徒）'};
export function readInterviewTrial(state,staff,view,today=getJapanDate()){
 assertInterviewAccess(staff);
 const rows=state.rows??[];
 return {requests:structuredClone(view==='staff'?rows:rows.filter(r=>r.studentCode===staff.staffCode)),
  studentName:studentNames[staff.staffCode],slots:interviewTrialSlots(today).filter(s=>s.date>=trialDay(2,today)).map(s=>({...s,available:!occupied(s,rows,null,staff.staffCode)}))};
}
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new InterviewError('入力内容・文字数を確認してください。');return value.trim();}
export function changeInterviewTrial(saved,staff,view,input,today=getJapanDate()){
 assertInterviewAccess(staff);
 if(!['student','staff'].includes(view))throw new InterviewError('操作画面を確認してください。',403);
 if(view==='staff'&&!['admin','office','employee'].includes(staff.role))throw new InterviewError('職員側の操作権限がありません。',403);
 if(!input||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.operationKey??''))throw new InterviewError('操作番号を確認してください。');
 const state=structuredClone(saved??{rows:[],operations:[],events:[]});state.rows??=[];state.operations??=[];state.events??=[];
 const fingerprint=JSON.stringify({staffId:staff.staffId,view,input});
 const previous=state.operations.find(o=>o.key===input.operationKey);
 if(previous){if(previous.fingerprint!==fingerprint)throw new InterviewError('同じ操作番号の内容が違います。',409);return {state,result:previous.result,replayed:true};}
 if(state.operations.length>=2000)throw new InterviewError('確認用の操作履歴が上限に達しました。管理者へお知らせください。',409);
 const action=input.action;let row=state.rows.find(r=>r.id===input.id);const before=row?structuredClone(row):null;
 if(view==='student'&&!['submit','change','cancel','withdraw'].includes(action))throw new InterviewError('生徒画面ではこの操作はできません。',403);
 if(view==='staff'&&!['approve','reject','approve_cancel','reject_cancel'].includes(action))throw new InterviewError('操作を確認してください。',403);
 if(action!=='submit'){
  if(!row||(view==='student'&&row.studentCode!==staff.staffCode))throw new InterviewError('対象の申請を確認してください。',403);
  if(input.version!==row.version)throw new InterviewError('状況が更新されました。最新の状況を確認してください。',409);
 }
 if(['submit','change'].includes(action)){
  if(action==='change'&&row.status!=='approved')throw new InterviewError('確定した面談だけ変更申請できます。',409);
  if(action==='change'&&row.confirmed.date<trialDay(2,today))throw new InterviewError('Webでの変更申請は2日前までです。職員へ連絡してください。');
  if(!Array.isArray(input.choices)||input.choices.length<1||input.choices.length>3||new Set(input.choices).size!==input.choices.length)throw new InterviewError('第1希望から、異なる日時を最大3件選んでください。');
  const slots=interviewTrialSlots(today);const choices=input.choices.map(id=>slots.find(s=>s.id===id));
  if(choices.some(s=>!s||!isValidReservationDate(s.date)||s.date<trialDay(2,today)))throw new InterviewError('Web申請は面談日の2日前までです。受付中の日時を選んでください。');
  if(choices.some(s=>occupied(s,state.rows,row?.id,staff.staffCode)))throw new InterviewError('希望日時が予約済みです。別の日時を選んでください。',409);
  if(choices.some(s=>s.campus!==choices[0].campus))throw new InterviewError('希望日時は同じ校舎で選んでください。');
  const details={purpose:text(input.purpose,500,true),participants:text(input.participants,500,true),method:text(input.method,30,true),note:text(input.note??'',1500)};
  if(!['対面','Zoom','電話','ハイブリッド'].includes(details.method))throw new InterviewError('面談方法を選んでください。');
  if(action==='submit'){
   if(state.rows.filter(r=>r.studentCode===staff.staffCode&&['pending',...active].includes(r.status)).length>=10)throw new InterviewError('申請中の面談を確認してください。',409);
   row={id:crypto.randomUUID(),studentCode:staff.staffCode,studentName:studentNames[staff.staffCode],status:'pending',version:1,choices,details,confirmed:null};state.rows.push(row);
  }else{row.proposed={choices,details};row.status='change_requested';row.version++;}
 }else if(action==='cancel'){
  if(!['pending','approved'].includes(row.status))throw new InterviewError('この状態では取消できません。',409);
  if(row.status==='approved'&&row.confirmed.date<trialDay(2,today))throw new InterviewError('Webでの取消申請は2日前までです。職員へ連絡してください。');
  row.reason=text(input.reason,500,true);row.status=row.status==='pending'?'cancelled':'cancel_requested';row.version++;
 }else if(action==='withdraw'){
  if(!['change_requested','cancel_requested'].includes(row.status))throw new InterviewError('申請を確認してください。',409);
  row.proposed=null;row.status='approved';row.version++;
 }else if(action==='approve'){
  if(!['pending','change_requested'].includes(row.status))throw new InterviewError('承認待ちの面談だけ確定できます。',409);
  const selection=(row.proposed?.choices??row.choices).find(s=>s.id===input.slotId);
  if(!selection||selection.date<today||occupied(selection,state.rows,row.id,row.studentCode))throw new InterviewError('希望日時が利用できません。最新の予定を確認してください。',409);
  row.confirmed=selection;if(row.proposed){row.choices=row.proposed.choices;row.details=row.proposed.details;}row.proposed=null;row.status='approved';row.version++;
 }else if(action==='reject'){
  if(!['pending','change_requested'].includes(row.status))throw new InterviewError('承認待ちの面談を選んでください。',409);
  row.reason=text(input.reason,500,true);row.status=row.status==='pending'?'rejected':'approved';row.proposed=null;row.version++;
 }else if(['approve_cancel','reject_cancel'].includes(action)){
  if(row.status!=='cancel_requested')throw new InterviewError('取消申請中の面談を選んでください。',409);
  row.reason=text(input.reason,500,true);row.status=action==='approve_cancel'?'cancelled':'approved';row.version++;
 }
 if(!row)throw new InterviewError('操作を確認してください。');
 row.updatedAt=new Date().toISOString();
 const result={request:structuredClone(row)};
 state.events.push({at:row.updatedAt,staffId:staff.staffId,view,action,before,after:structuredClone(row)});
 state.operations.push({key:input.operationKey,fingerprint,result});
 return {state,result,replayed:false};
}
