import {digest,isEnrollmentId,validateEnrollmentPayload,pendingEnrollmentFields,ENROLLMENT_SOURCES,propertyText,seedEnrollmentFields,pageSnapshot} from './enrollment-core.mjs';
import {enrollmentPage,intakeCandidates,prepareEnrollment,runEnrollmentEntry} from './enrollment-notion.mjs';
import {queryPages} from './bensuke-booking.mjs';
import {InterviewError} from './interview-core.mjs';

function database(result){if(result.error){const conflict=/enrollment_conflict/.test(result.error.message);throw new InterviewError(conflict?'別の操作で保存内容が変わりました。入力を保持したまま最新の内容を確認してください。':'入力記録の保存先へ接続できませんでした。',conflict?409:503);}return result.data;}
export async function enrollmentList(db){return database(await db.from('enrollment_entries').select('id,student_page_id,payload,status,version,updated_at').order('updated_at',{ascending:false}).limit(60)).map(r=>({id:r.id,studentName:r.payload.studentName,studentNumber:r.payload.studentNumber,status:r.status,version:r.version,updatedAt:r.updated_at,pending:pendingEnrollmentFields(r.payload).length}));}
export async function enrollmentRead(db,id){if(!isEnrollmentId(id))throw new InterviewError('入力記録を選び直してください。',422);const entry=database(await db.from('enrollment_entries').select('*').eq('id',id).maybeSingle());if(!entry)throw new InterviewError('入力記録が見つかりません。',404);return entry;}
export async function enrollmentSearch(request,query){
 if(typeof query!=='string'||query.trim().length<1||query.length>100)throw new InterviewError('生徒名を入力してください。',422);
 const rows=await request(`/data_sources/${ENROLLMENT_SOURCES.student}/query`,{method:'POST',body:JSON.stringify({page_size:30,filter:{property:'生徒氏名',title:{contains:query.trim()}}})});
 return {students:rows.results.map(p=>({id:p.id,name:propertyText(p.properties['生徒氏名']),number:propertyText(p.properties['学籍番号']),campus:propertyText(p.properties['所属']),grade:propertyText(p.properties['学年']),status:propertyText(p.properties['状態'])})),hasMore:!!rows.has_more};
}
export async function enrollmentContext({db,request,studentPageId,entryId,staff}){
 const entry=entryId?await enrollmentRead(db,entryId):database(await db.from('enrollment_entries').select('*').eq('student_page_id',studentPageId).maybeSingle());
 const student=await enrollmentPage(request,entry?.student_page_id??studentPageId,'student');
 const candidates=await intakeCandidates(request,student.id);
 const selected=candidates.find(c=>c.id===entry?.payload.intakePageId)??(candidates.length===1?candidates[0]:null);
 const payload=entry?.payload??{studentPageId:student.id,intakePageId:selected?.id??'',fields:seedEnrollmentFields(student,selected),record:'',sourceText:''};
 const prepared=await prepareEnrollment({request,payload:structuredClone(payload),prior:entry,staff});
 return {entry,payload,student:{id:student.id,name:propertyText(student.properties['生徒氏名']),number:propertyText(student.properties['学籍番号']),url:student.url,values:{...Object.fromEntries(Object.entries(student.properties).filter(([k])=>['状態','担任','所属','学年','本当の入塾日','入塾手続日'].includes(k)).map(([k,v])=>[k,propertyText(v)])),'入塾時のクラス':propertyText(selected?.properties?.['入塾時のクラス']),'入塾手続き時の備考':propertyText(selected?.properties?.['入塾手続き時の備考'])}},
  intakes:candidates.map(p=>({id:p.id,title:propertyText(p.properties['問合せ内容']),status:propertyText(p.properties['状態（問合DBのみの）']),date:propertyText(p.properties['入塾手続き日']),snapshot:pageSnapshot(p),url:p.url})),
  snapshot:digest(Object.fromEntries(Object.entries(prepared.targets).map(([k,v])=>[k,{pageId:v.pageId,baseline:v.baseline}]))),
  stableSnapshot:digest(Object.fromEntries(Object.entries(prepared.targets).filter(([k])=>k!=='intake').map(([k,v])=>[k,{pageId:v.pageId,baseline:v.baseline}]))),
  staffOptions:prepared.staffOptions,actorIssue:prepared.payload.actorIssue};
}
export async function saveEnrollment({db,request,body,context}){
 if(!isEnrollmentId(body.id)||!isEnrollmentId(body.operationKey)||!Number.isInteger(body.version))throw new InterviewError('保存画面を開き直してください。',422);
 const requestHash=digest(body);
 // Check the committed operation before reading remote values, including after a lost response.
 const event=database(await db.from('enrollment_entry_events').select('entry_id,actor_id,request_hash').eq('operation_key',body.operationKey).maybeSingle());
 if(event){if(event.entry_id!==body.id||event.actor_id!==context.staff.staffId||event.request_hash!==requestHash)throw new InterviewError('操作番号が重複しています。',409);return enrollmentRead(db,body.id);}
 const payload=validateEnrollmentPayload(body.payload);
 const prior=body.version?await enrollmentRead(db,body.id):null;
 if(prior?.version!==undefined&&prior.version!==body.version)throw new InterviewError('別の保存で内容が変わっています。再取得して確認してください。',409);
 const prepared=await prepareEnrollment({request,payload,prior,staff:context.staff});
 const snapshot=digest(Object.fromEntries(Object.entries(prepared.targets).map(([k,v])=>[k,{pageId:v.pageId,baseline:v.baseline}])));
 // Choosing a different intake is an explicit human decision. Its page is still
 // validated by the server against this student, with its own fresh snapshot.
 if(body.snapshot!==snapshot){
  const selectedChanged=!!payload.intakePageId&&payload.intakePageId!==prior?.payload.intakePageId;
  if(!selectedChanged||body.intakeSnapshot!==pageSnapshot(await enrollmentPage(request,payload.intakePageId,'intake')))throw new InterviewError('Notionの内容が画面を開いた後に変わりました。「最新情報を確認」で比較してください。入力は保持しています。',409);
  // Intake selection must never bypass a student or existing output conflict.
  const stable=body.stableSnapshot;
  const expected=digest(Object.fromEntries(Object.entries(prepared.targets).filter(([k])=>k!=='intake').map(([k,v])=>[k,{pageId:v.pageId,baseline:v.baseline}])));
  if(stable!==expected)throw new InterviewError('生徒情報や面談記録が更新されています。最新情報を確認してください。',409);
 }
 for(const [key,field]of Object.entries(prepared.payload.fields))if(field.state==='confirmed'){
  const old=prior?.payload.fields?.[key];const comparable=old?{value:old.value,state:old.state,reason:old.reason,source:old.source,candidates:old.candidates}:null;
  const unchanged=JSON.stringify(comparable)===JSON.stringify(field);
  field.confirmedBy=unchanged?old.confirmedBy:context.staff.staffId;field.confirmedAt=unchanged?old.confirmedAt:new Date().toISOString();
 }
 database(await db.rpc('enrollment_entry_save',{p_user:context.identity.authUserId,p_session:context.identity.authSessionId,p_operation:body.operationKey,p_id:body.id,p_version:body.version,p_payload:prepared.payload,p_targets:prepared.targets,p_hash:requestHash}));
 return enrollmentRead(db,body.id);
}
export async function processEnrollment({db,request,id=null}){
 const entry=database(await db.rpc('enrollment_entry_claim',{p_id:id??null}));if(!entry)return {processed:false};
 const checkpoint=async(targets,status)=>database(await db.rpc('enrollment_entry_checkpoint',{p_id:entry.id,p_lease:entry.lease,p_targets:targets,p_status:status}));
 try{return {processed:true,...await runEnrollmentEntry({entry,request,checkpoint})};}
 catch{
  await checkpoint(entry.targets,'partial');return {processed:false,status:'partial'};
 }
}
export async function retryEnrollment(db,id){
 const entry=await enrollmentRead(db,id);
 if(entry.status==='running')return entry;
 database(await db.from('enrollment_entries').update({status:'queued',next_attempt_at:new Date().toISOString()}).eq('id',entry.id).eq('version',entry.version).is('lease',null));
 return enrollmentRead(db,id);
}
export async function enrollmentHistory(request,id){
 const rows=await queryPages(request,ENROLLMENT_SOURCES.interview,{property:'生徒情報DB',relation:{contains:id}},5);
 return rows.map(p=>({id:p.id,title:propertyText(p.properties['面談内容']),date:propertyText(p.properties['面談日']),purpose:propertyText(p.properties['面談目的']),url:p.url})).sort((a,b)=>b.date.localeCompare(a.date));
}
