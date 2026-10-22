import {InterviewError} from './interview-core.mjs';
import {isEnrollmentId,sameNotionId} from './enrollment-core.mjs';
import {digest,validatePostPayload,planPostDelivery,confirmed,postFields,blankPostFields} from './post-interview-core.mjs';
import {preparePostContext,postDesiredProperties,postSurveyProperties,runPostNotion} from './post-interview-notion.mjs';
import {runPostDeliveries} from './post-interview-delivery.mjs';
import {syncParentContactLog} from './parent-contact-sync.mjs';
import {runVisitNotion} from './visit-followup-notion.mjs';
export function postDatabase(result){if(result.error)throw new InterviewError(/conflict|unique/.test(result.error.message)?'保存内容が別の操作で変わりました。入力を保持して最新の内容を確認してください。':'面談入力の保存先を確認できません。',/conflict|unique/.test(result.error.message)?409:503);return result.data;}
export async function readPostEntry(db,id){if(!isEnrollmentId(id))throw new InterviewError('入力記録を選び直してください。',422);const entry=postDatabase(await db.from('post_interview_entries').select('*').eq('id',id).maybeSingle());if(!entry)throw new InterviewError('入力記録が見つかりません。',404);return entry;}
export async function postEntries(db,answerId){return postDatabase(await db.from('post_interview_entries').select('id,answer_page_id,payload,status,version,updated_at').eq('answer_page_id',answerId).order('updated_at',{ascending:false}).limit(40)).map(e=>({id:e.id,title:e.payload.fields.title.value||'面談記録の下書き',date:e.payload.fields.date.value,status:e.status,version:e.version,updatedAt:e.updated_at}));}
export async function savePostLine({db,body,context,verifyAnswer,recipients}){
 if(!isEnrollmentId(body.id)||!isEnrollmentId(body.operationKey)||!isEnrollmentId(body.answerId)||!isEnrollmentId(body.studentPageId)||!Number.isInteger(body.version)||body.version<0)throw new InterviewError('送信する生徒を選び直してください。',422);
 const requestHash=digest(body),event=postDatabase(await db.from('post_interview_entry_events').select('entry_id,actor_id,request_hash').eq('operation_key',body.operationKey).maybeSingle());
 if(event){if(event.entry_id!==body.id||event.actor_id!==context.staff.staffId||event.request_hash!==requestHash)throw new InterviewError('操作番号が重複しています。',409);return readPostEntry(db,body.id);}
 const prior=body.version?await readPostEntry(db,body.id):null;
 if(prior&&(prior.version!==body.version||!sameNotionId(prior.answer_page_id,body.answerId)||!sameNotionId(prior.student_page_id,body.studentPageId)))throw new InterviewError('保存内容が更新されています。最新の送信結果を確認してください。',409);
 const verified=await verifyAnswer(body.answerId);
 if(!sameNotionId(verified.profile.id,body.studentPageId))throw new InterviewError('生徒情報が一致しません。',409);
 const number=String(verified.student.student_number),accounts=await recipients(number);
 const lines=planPostDelivery({previous:prior?.targets.lines??{},approval:body.deliveryApproval,accounts,entryId:body.id,direct:true});
 const payload=prior?structuredClone(prior.payload):{answerId:body.answerId,studentPageId:body.studentPageId,recordPageId:'',sourceText:'',participants:'',fields:blankPostFields(),intent:'draft'};
 payload.studentName=verified.student.student_name;payload.studentNumber=number;payload.actorName=context.staff.displayName;
 const targets={...(prior?.targets??{record:{status:'skipped'},survey:{status:'skipped'}}),lines};
 postDatabase(await db.rpc('post_interview_entry_save',{p_user:context.identity.authUserId,p_session:context.identity.authSessionId,p_operation:body.operationKey,p_id:body.id,p_version:body.version,p_payload:payload,p_targets:targets,p_hash:requestHash}));
 return readPostEntry(db,body.id);
}
export async function savePostEntry({db,request,body,context,verifyAnswer,recipients}){
 if(!isEnrollmentId(body.id)||!isEnrollmentId(body.operationKey)||!Number.isInteger(body.version)||!['draft','reflect','send'].includes(body.intent))throw new InterviewError('保存内容を確認してください。',422);
 const requestHash=digest(body),event=postDatabase(await db.from('post_interview_entry_events').select('entry_id,actor_id,request_hash').eq('operation_key',body.operationKey).maybeSingle());
 if(event){if(event.entry_id!==body.id||event.actor_id!==context.staff.staffId||event.request_hash!==requestHash)throw new InterviewError('操作番号が重複しています。',409);return readPostEntry(db,body.id);}
 const payload=validatePostPayload(body.payload),prior=body.version?await readPostEntry(db,body.id):null;
 if(prior&&(prior.version!==body.version||!sameNotionId(prior.answer_page_id,payload.answerId)||!sameNotionId(prior.student_page_id,payload.studentPageId)))throw new InterviewError('入力記録の版・対象を再確認してください。',409);
 const verified=await verifyAnswer(payload.answerId);if(!sameNotionId(verified.profile.id,payload.studentPageId))throw new InterviewError('生徒情報が一致しません。',409);
 if(prior?.targets.record.pageId&&!sameNotionId(payload.recordPageId,prior.targets.record.pageId))throw new InterviewError('保存済み案件の面談記録は付け替えず、別の案件を作成してください。',409);
 const prepared=await preparePostContext({request,verified,entry:null,recordId:payload.recordPageId,staff:context.staff});
 if(body.snapshot!==prepared.snapshot)throw new InterviewError('原本が更新されています。入力を保持して「原本を再確認」してください。',409);
 if(!payload.recordPageId&&!prior&&body.confirmNewRecord!==true)throw new InterviewError('新しい面談記録を作ることを確認してください。',422);
 if(prior&&body.intent!=='send'&&Object.values(prior.targets.lines??{}).some(line=>['pending','sending'].includes(line.status)))throw new InterviewError('送信処理中です。結果を確認してから記録を変更してください。',409);
 const schema=await request('/data_sources/19ef0120-80a7-808a-8992-000b85713577');
 if(confirmed(payload,'author')&&!prepared.staffOptions.some(p=>sameNotionId(p.id,confirmed(payload,'author'))))throw new InterviewError('記入者を職員一覧から選び直してください。',422);
 postDesiredProperties(payload,schema);
 const surveySchema=await request('/data_sources/'+verified.answer.parent.data_source_id);
 if(confirmed(payload,'handling')&&!surveySchema.properties['対応']?.select?.options?.some(o=>o.name===confirmed(payload,'handling')))throw new InterviewError('アンケートの対応の選択肢を確認してください。',422);
 if(confirmed(payload,'handling'))postSurveyProperties(surveySchema,confirmed(payload,'handling'));
 for(const def of postFields){const f=payload.fields[def.key],old=prior?.payload.fields[def.key];if(f.state==='confirmed'){const comparable=value=>Object.fromEntries(['value','state','source','reason','candidates'].map(key=>[key,value[key]]));const unchanged=old&&digest(comparable(old))===digest(comparable(f));f.confirmedBy=unchanged?old.confirmedBy:context.staff.staffId;f.confirmedAt=unchanged?old.confirmedAt:new Date().toISOString();}}
 const targetFingerprint=digest({fields:Object.fromEntries(postFields.filter(f=>f.key!=='summary'&&f.key!=='handling').map(f=>[f.key,{value:confirmed(payload,f.key),state:payload.fields[f.key].state}]))});
 const oldRecord=prior?.targets.record??{};const reflect=body.intent!=='draft';
 const record={...oldRecord,...prepared.snapshots.record,status:reflect?(oldRecord.fingerprint===targetFingerprint&&oldRecord.status==='synced'?'synced':'pending'):'skipped',fingerprint:targetFingerprint,error:''};
 const oldSurvey=prior?.targets.survey??{};const handlingHash=digest({value:confirmed(payload,'handling'),state:payload.fields.handling.state,...(confirmed(payload,'handling')==='対応済'?{preparation:'complete-with-handled-v1'}:{})});
 const survey={...oldSurvey,...prepared.snapshots.survey,status:reflect?(oldSurvey.fingerprint===handlingHash&&oldSurvey.status==='synced'?'synced':'pending'):'skipped',fingerprint:handlingHash,error:''};
 const workLogHash=digest({form:payload.workLog,date:{value:confirmed(payload,'date'),state:payload.fields.date.state}}),oldWorkLog=prior?.targets.workLog??{};
 const workLog={...oldWorkLog,status:reflect&&payload.workLog.enabled?(oldWorkLog.fingerprint===workLogHash&&oldWorkLog.status==='synced'?'synced':'pending'):'skipped',fingerprint:workLogHash,error:''};
 if(body.intent==='send'&&(!prior||prior.targets.record.status!=='synced'||oldRecord.fingerprint!==targetFingerprint))throw new InterviewError('先に確定した内容を記録へ反映し、最新の結果を確認してください。',409);
 const accounts=body.intent==='send'?await recipients(String(verified.student.student_number)):[];
 const lines=planPostDelivery({previous:prior?.targets.lines??{},approval:body.intent==='send'?body.deliveryApproval:null,accounts,summary:confirmed(payload,'summary'),entryId:body.id});
 payload.studentName=verified.student.student_name;payload.studentNumber=String(verified.student.student_number);payload.answerSourceId=verified.answer.parent.data_source_id;payload.surveySchema={properties:{対応:surveySchema.properties['対応'],面談準備:surveySchema.properties['面談準備']}};payload.actorName=context.staff.displayName;payload.originalBody=prepared.originalBody;payload.intent=body.intent;
 postDatabase(await db.rpc('post_interview_entry_save',{p_user:context.identity.authUserId,p_session:context.identity.authSessionId,p_operation:body.operationKey,p_id:body.id,p_version:body.version,p_payload:payload,p_targets:{record,survey,workLog,lines},p_hash:requestHash}));return readPostEntry(db,body.id);
}
export async function processPostEntry({db,request,id=null,recipients,fetcher=fetch,lineToken='',cloudKey='',lineOnly=false}){
 const entry=postDatabase(await db.rpc('post_interview_entry_claim',{p_id:id}));if(!entry)return {processed:false};
 const checkpoint=async(targets,status)=>postDatabase(await db.rpc('post_interview_entry_checkpoint',{p_id:entry.id,p_lease:entry.lease,p_targets:targets,p_status:status}));
 try{
  const delivery={entry,checkpoint,validateRecipient:async(id,number,line)=>{const accounts=await recipients(number);return accounts.some(a=>a.id===id&&(line.independent||a.verification==='confirmed'&&a.category!=='unknown'));},
   findSent:async historyId=>postDatabase(await db.from('line_messages').select('id').eq('line_message_id',historyId).maybeSingle()),
   sendLine:line=>{if(!lineToken)throw new Error('LINE configuration unavailable');return fetcher('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+lineToken,'Content-Type':'application/json','X-Line-Retry-Key':line.key},signal:AbortSignal.timeout(10000),body:JSON.stringify({to:line.id,messages:[{type:'text',text:line.text}]})});},
    storeSent:async({historyId,line,entry})=>{const result=await db.from('line_messages').insert({line_message_id:historyId,line_user_id:line.id,direction:'outbound',message_type:'text',text:line.text,sent_by:entry.payload.actorName,received_at:new Date().toISOString(),raw_event:{operation:'post_interview',entry_id:entry.id,version:entry.version,line_retry_key:line.key,line_request_id:line.requestId}});if(!result.error)return true;return !!postDatabase(await db.from('line_messages').select('id').eq('line_message_id',historyId).maybeSingle());}};
  await runPostDeliveries({...delivery,onlyIndependent:true});
  if(!lineOnly){
   if(entry.payload.intent!=='draft'){
    if(entry.payload.workflow==='visit-followup')await runVisitNotion({entry,request,checkpoint});
    else if(entry.payload.workflow!=='parent-contact')await runPostNotion({entry,request,checkpoint});
   }
   if(entry.payload.intent!=='draft')await syncParentContactLog({db,entry,checkpoint,key:cloudKey,fetcher});
   await runPostDeliveries(delivery);
  }
  const values=[entry.targets.record,entry.targets.survey,...['student','intake','mtg','workLog'].flatMap(key=>entry.targets[key]?[entry.targets[key]]:[]),...Object.values(entry.targets.lines)];
  const pending=values.some(s=>['pending','retry','creating'].includes(s.status));const review=values.some(s=>!['synced','accepted','external','skipped'].includes(s.status))||Object.values(entry.payload.fields).some(f=>!['confirmed','not_applicable'].includes(f.state));
  const status=pending?'partial':review||entry.payload.intent==='draft'?'review':'complete';await checkpoint(entry.targets,status);return {processed:true,status};
 }catch{await checkpoint(entry.targets,'partial');return {processed:false,status:'partial'};}
}
