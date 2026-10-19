import {InterviewError} from './interview-core.mjs';
import {digest,isEnrollmentId,propertyText} from './enrollment-core.mjs';
import {enrollmentPage} from './enrollment-notion.mjs';
import {blankPostFields} from './post-interview-core.mjs';
import {normalizeParentWorkLog} from './parent-contact-core.mjs';
import {isValidReservationDate} from './reservation-date.mjs';
import {postDatabase,readPostEntry} from './post-interview-service.mjs';
export async function readParentContactEntry(db,id){const entry=await readPostEntry(db,id);if(entry.payload.workflow!=='parent-contact')throw new InterviewError('業務記録の入力を選び直してください。',409);return entry;}
export async function saveParentContactEntry({db,request,body,context}){
 if(!isEnrollmentId(body.id)||!isEnrollmentId(body.operationKey)||!Number.isInteger(body.version)||body.version<0||!['draft','reflect'].includes(body.intent)||!isEnrollmentId(body.studentPageId))throw new InterviewError('保存する対象と操作を確認してください。',422);
 const requestHash=digest(body),event=postDatabase(await db.from('post_interview_entry_events').select('entry_id,actor_id,request_hash').eq('operation_key',body.operationKey).maybeSingle());
 if(event){if(event.entry_id!==body.id||event.actor_id!==context.staff.staffId||event.request_hash!==requestHash)throw new InterviewError('操作番号が重複しています。',409);return readParentContactEntry(db,body.id);}
 const prior=body.version?await readParentContactEntry(db,body.id):null;
 if(prior&&(prior.version!==body.version||prior.student_page_id!==body.studentPageId))throw new InterviewError('保存内容が変わりました。入力を保持して最新の記録を確認してください。',409);
 if(!isValidReservationDate(body.date))throw new InterviewError('実施日を入力してください。',422);
 const student=await enrollmentPage(request,body.studentPageId,'student');
 const fields=blankPostFields();for(const f of Object.values(fields))f.state='not_applicable';fields.date={...fields.date,value:body.date,state:'confirmed',source:'職員が実施日を入力',confirmedBy:context.staff.staffId,confirmedAt:new Date().toISOString()};
 const workLog=normalizeParentWorkLog(body.workLog);workLog.enabled=true;
 const payload={workflow:'parent-contact',answerId:student.id,studentPageId:student.id,studentName:propertyText(student.properties['生徒氏名']),studentNumber:propertyText(student.properties['学籍番号']),actorName:context.staff.displayName,fields,workLog,intent:body.intent};
 const hash=digest({date:body.date,form:workLog}),old=prior?.targets.workLog??{};
 const targets={record:{status:'skipped'},survey:{status:'skipped'},lines:{},workLog:{...old,status:body.intent==='draft'?'skipped':old.fingerprint===hash&&old.status==='synced'?'synced':'pending',fingerprint:hash,error:''}};
 postDatabase(await db.rpc('post_interview_entry_save',{p_user:context.identity.authUserId,p_session:context.identity.authSessionId,p_operation:body.operationKey,p_id:body.id,p_version:body.version,p_payload:payload,p_targets:targets,p_hash:requestHash}));
 return readParentContactEntry(db,body.id);
}
