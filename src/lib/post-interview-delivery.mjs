import {InterviewError} from './interview-core.mjs';
export async function runPostDeliveries({entry,checkpoint,sendLine,findSent,storeSent,validateRecipient,onlyIndependent=false}){
 const save=async()=>{if(!await checkpoint(entry.targets,'running'))throw new InterviewError('処理の版が変わりました。',409);};
 for(const line of Object.values(entry.targets.lines??{})){
  if(onlyIndependent&&!line.independent)continue;
  if(!['pending','sending'].includes(line.status))continue;
  if(!line.independent&&entry.targets.record.status!=='synced'){line.error='面談記録の反映後に送信します。';continue;}
  const historyId=`out_post_interview_${line.key}`;
  const prior=await findSent(historyId);if(prior){line.status='accepted';line.error='';await save();continue;}
  if(line.status==='sending'){line.status='unknown';line.error='前回の送信結果を確認できません。LINE履歴を確認してください。';await save();continue;}
  if(!await validateRecipient(line.id,entry.payload.studentNumber,line)){line.status='review';line.error='送り先の登録が変わりました。送り先を再読み込みしてください。';await save();continue;}
  line.status='sending';line.attemptedAt=new Date().toISOString();await save();
  try{
   const response=await sendLine(line);const accepted=response.ok||response.status===409&&!!response.headers.get('x-line-accepted-request-id');
   if(!accepted){line.status='failed';line.error=`LINEが送信を受け付けませんでした（${response.status}）。`;await save();continue;}
   line.acceptedAt=new Date().toISOString();line.requestId=response.headers.get('x-line-accepted-request-id')??response.headers.get('x-line-request-id');
   if(!await storeSent({historyId,line,entry})){line.status='unknown';line.error='LINEは受け付けましたが履歴保存を確認できません。再送せず履歴を確認してください。';}
   else{line.status='accepted';line.error='';}
  }catch{line.status='unknown';line.error='LINEの受付結果を確認できません。再送せず履歴を確認してください。';}
  await save();
 }
}
