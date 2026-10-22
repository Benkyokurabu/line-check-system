import {InterviewError} from './interview-core.mjs';
import {digest,isEnrollmentId,sameNotionId} from './enrollment-core.mjs';
import {VISIT_WORKFLOW,validateVisitPayload,visitSnapshot} from './visit-followup-core.mjs';
import {prepareVisit} from './visit-followup-notion.mjs';
// Keep storage orchestration independent of the post-interview worker module.
const checked=result=>{if(result.error)throw new InterviewError(/conflict|unique/.test(result.error.message)?'保存版または面談記録が競合しています。原本を再確認してください。':'入力記録を保存できませんでした。入力は保持しています。',/conflict|unique/.test(result.error.message)?409:503);return result.data;};
export async function readVisit(db,id){
 if(!isEnrollmentId(id))throw new InterviewError('入力記録を選び直してください。',422);
 const entry=checked(await db.from('post_interview_entries').select('*').eq('id',id).maybeSingle());
 if(!entry||entry.payload.workflow!==VISIT_WORKFLOW)throw new InterviewError('見学打合せ後の入力記録を選び直してください。',409);return entry;
}
/** @param {{db: *, request: *, staff: *, studentPageId:string, entryId:string, intakePageId?:string|null, recordSelection?:string|null}} args */
export async function visitContext({db,request,staff,studentPageId,entryId,intakePageId=null,recordSelection=null}){
 const entry=entryId?await readVisit(db,entryId):null;
 const prepared=await prepareVisit({request,staff,studentPageId:entry?.student_page_id??studentPageId,intakePageId:intakePageId??entry?.payload.intakePageId??'',recordSelection:recordSelection??entry?.payload.recordSelection??'',prior:entry});
 return {...prepared,entry,payload:entry?{...entry.payload,intakePageId:prepared.payload.intakePageId}:prepared.payload};
}
export async function saveVisit({db,request,body,context}){
 if(!isEnrollmentId(body.id)||!isEnrollmentId(body.operationKey)||!isEnrollmentId(body.payload?.studentPageId)||!Number.isInteger(body.version)||body.version<0||!['draft','reflect'].includes(body.intent))throw new InterviewError('保存する対象と操作を確認してください。',422);
 const requestHash=digest(body),event=checked(await db.from('post_interview_entry_events').select('entry_id,actor_id,request_hash').eq('operation_key',body.operationKey).maybeSingle());
 if(event){if(event.entry_id!==body.id||event.actor_id!==context.staff.staffId||event.request_hash!==requestHash)throw new InterviewError('操作番号が重複しています。',409);return readVisit(db,body.id);}
 const prior=body.version?await readVisit(db,body.id):null;
 if(prior&&(prior.version!==body.version||!sameNotionId(prior.student_page_id,body.payload?.studentPageId)))throw new InterviewError('保存版または対象の生徒が変わりました。',409);
 if(prior?.targets.record?.pageId&&body.payload.recordSelection!==prior.payload.recordSelection)throw new InterviewError('保存した面談記録は付け替えず、新しい案件として入力してください。',409);
 const prepared=await prepareVisit({request,staff:context.staff,studentPageId:body.payload?.studentPageId,intakePageId:body.payload?.intakePageId,recordSelection:body.payload?.recordSelection,prior});
 const payload=validateVisitPayload(body.payload,prepared.options);
 if(body.intent==='reflect'&&body.snapshot!==prepared.snapshot)throw new InterviewError('Notion原本が更新されています。入力を保持して原本を再確認してください。',409);
 if(body.intent==='reflect'&&!payload.recordSelection)throw new InterviewError('新しい面談記録か、既存の面談記録かを選択してください。',422);
 if(payload.fields.visitStaff.state==='confirmed'&&!prepared.staffOptions.some(s=>sameNotionId(s.id,payload.fields.visitStaff.value)))throw new InterviewError('見学打合せの担当者を選び直してください。',422);
 // Persist exactly the explicitly selected intake. Never revive a cleared choice.
 const targets={record:{},student:{},intake:{},mtg:{},survey:{status:'skipped'},lines:{}};
 for(const target of ['record','student','intake','mtg']){
  targets[target]={...prepared.targets[target],status:body.intent==='draft'?'skipped':'pending',error:''};
 }
 if(!payload.intakePageId)targets.intake={pageId:null,baseline:{},status:body.intent==='draft'?'skipped':'pending',error:''};
 for(const [key,field]of Object.entries(payload.fields))if(field.state==='confirmed'){
  const old=prior?.payload.fields[key],same=old?.state===field.state&&old?.value===field.value;
  field.confirmedBy=same?old.confirmedBy:context.staff.staffId;field.confirmedAt=same?old.confirmedAt:new Date().toISOString();
 }
 const contentHash=digest({fields:payload.fields,record:payload.record,intakeNote:payload.intakeNote});
 if(body.intent==='reflect')for(const target of ['record','student','intake','mtg']){
  const old=prior?.targets[target];
  if(old?.status==='synced'&&old.fingerprint===contentHash&&old.pageId===targets[target].pageId&&digest(old.baseline)===digest(targets[target].baseline))targets[target].status='synced';
 }
 Object.assign(payload,{actorPageId:prepared.actorPageId,actorName:context.staff.displayName,studentName:prepared.student.name,studentNumber:prepared.student.number,intent:body.intent});
 const hash=digest({form:payload.workLog,date:payload.fields.date}),old=prior?.targets.workLog??{};
 targets.workLog={...old,status:body.intent==='reflect'&&payload.workLog.enabled?(old.fingerprint===hash&&old.status==='synced'?'synced':'pending'):'skipped',fingerprint:hash,error:''};
 checked(await db.rpc('post_interview_entry_save',{p_user:context.identity.authUserId,p_session:context.identity.authSessionId,p_operation:body.operationKey,p_id:body.id,p_version:body.version,p_payload:payload,p_targets:targets,p_hash:requestHash}));
 return readVisit(db,body.id);
}
export {visitSnapshot};
