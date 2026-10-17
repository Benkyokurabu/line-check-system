import {ENROLLMENT_SOURCES as sources,pageSnapshot,propertyText,propertyComparable,desiredEnrollmentProperties,safePropertyPatch,sameNotionId,known,pendingEnrollmentFields} from './enrollment-core.mjs';
import {InterviewError} from './interview-core.mjs';
import {queryPages,teacherMatch} from './bensuke-booking.mjs';
import {KUDO_NOTION_TEACHER_ID,KINJO_NOTION_TEACHER_ID} from './teacher-schedule-notion.mjs';

export async function enrollmentSchemas(request){const result={};for(const [key,id]of Object.entries(sources))result[key]=await request(`/data_sources/${id}`);return result;}
export async function enrollmentPage(request,id,kind){
 const page=await request(`/pages/${id}`);if(page.archived||page.in_trash||!sameNotionId(page.parent?.data_source_id,sources[kind]))throw new InterviewError('選択したNotionの記録を確認できません。生徒を選び直してください。',409);return page;
}
export async function intakeCandidates(request,studentPageId){return queryPages(request,sources.intake,{property:'生徒情報DB',relation:{contains:studentPageId}},5);}
export async function enrollmentStaffOptions(request,schema){
 const source=schema.properties['記入者']?.relation?.data_source_id;if(!source)throw new InterviewError('面談DBと職員DBの関連を確認してください。',409);
 const pages=await queryPages(request,source);const directory=pages.map(p=>({id:p.id,name:propertyText(Object.values(p.properties).find(v=>v.type==='title'))}));
 return directory;
}
export async function enrollmentActor(request,schema,staff,directory=null){
 directory??=await enrollmentStaffOptions(request,schema);
 const linked={KUDO:KUDO_NOTION_TEACHER_ID,KINJO:KINJO_NOTION_TEACHER_ID}[staff.staffCode];
 if(linked){const matches=directory.filter(p=>sameNotionId(p.id,linked));if(matches.length===1)return matches[0].id;throw new InterviewError('登録済みの職員とNotion職員情報の対応を確認できません。',409);}
 return teacherMatch(staff.displayName,directory).id;
}
export const propertyBaseline=page=>Object.fromEntries(Object.entries(page?.properties??{}).map(([k,p])=>[k,propertyComparable(p)]));
export async function prepareEnrollment({request,payload,prior,staff}){
 const schemas=await enrollmentSchemas(request);
 const student=await enrollmentPage(request,payload.studentPageId,'student');
 const candidates=await intakeCandidates(request,student.id);
 let intake=candidates.find(p=>sameNotionId(p.id,payload.intakePageId));
 if(payload.intakePageId&&!intake)throw new InterviewError('受付の記録が生徒と一致しません。選び直してください。',409);
 if(!intake&&candidates.length===1){intake=candidates[0];payload.intakePageId=intake.id;}
 let actorPageId='',actorIssue='',staffOptions=[];try{staffOptions=await enrollmentStaffOptions(request,schemas.interview);actorPageId=await enrollmentActor(request,schemas.interview,staff,staffOptions);}catch(e){actorIssue=e instanceof InterviewError?e.message:'Notionの職員対応を確認できません。';}
 const procedureStaff=known(payload,'procedureStaff');
 if(procedureStaff&&(!staffOptions.some(s=>sameNotionId(s.id,procedureStaff))||!sameNotionId(schemas.intake.properties['手続担当者']?.relation?.data_source_id,schemas.interview.properties['記入者']?.relation?.data_source_id)))throw new InterviewError('手続担当者と職員情報の対応を確認してください。',409);
 const targets={};
 for(const target of ['interview','student','intake','mtg']){
  const old=prior?.targets?.[target]??{};
  let page=target==='student'?student:target==='intake'?intake:null;
  if(old.pageId&&['interview','mtg'].includes(target))page=await enrollmentPage(request,old.pageId,target);
  targets[target]={...old,status:'pending',error:'',baseline:page?propertyBaseline(page):{},pageId:page?.id??old.pageId??null};
 }
 return {student,schemas,staffOptions,payload:{...payload,studentName:propertyText(student.properties['生徒氏名']),studentNumber:propertyText(student.properties['学籍番号']),actorPageId,actorIssue,actorName:staff.displayName},targets,snapshot:pageSnapshot(student)};
}
function richText(text){return [{type:'text',text:{content:text}}];}
const markerUrl=(id,version)=>`https://line-check-system.vercel.app/staff/enrollment?entry=${id}&revision=${version}`;
function recordBlocks(entry){
 const result=[{object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:`勉たんの入力記録（保存版 ${entry.version}）`,link:{url:markerUrl(entry.id,entry.version)}}}]}}];
 const text=entry.payload.record;
 for(let start=0;start<text.length;start+=1800)result.push({object:'block',type:'paragraph',paragraph:{rich_text:richText(text.slice(start,start+1800))}});
 return result;
}
async function allBlocks(request,id){let cursor='',result=[];for(let i=0;i<10;i++){const data=await request(`/blocks/${id}/children?page_size=100${cursor?'&start_cursor='+encodeURIComponent(cursor):''}`);result.push(...data.results);if(!data.has_more)return result;cursor=data.next_cursor;if(!cursor)break;}throw new InterviewError('記録の全文を確認できません。再登録を保留しました。',409);}
const hasMarker=(blocks,entry)=>blocks.some(b=>(b[b.type]?.rich_text??[]).some(t=>t.text?.link?.url===markerUrl(entry.id,entry.version)));
async function findInterview(request,entry){
 const pages=await queryPages(request,sources.interview,{property:'生徒情報DB',relation:{contains:entry.student_page_id}},5);
 const found=[];for(const page of pages){const blocks=await allBlocks(request,page.id);if(blocks.some(b=>(b[b.type]?.rich_text??[]).some(t=>t.text?.link?.url?.startsWith(`https://line-check-system.vercel.app/staff/enrollment?entry=${entry.id}&revision=`))))found.push(page);}
 if(found.length>1)throw new InterviewError('同じ入力記録の面談ページが複数あります。職員の確認が必要です。',409);
 return found[0];
}
async function findMtg(request,entry){
 const pages=await queryPages(request,sources.mtg,{property:'生徒名',relation:{contains:entry.student_page_id}},5);
 const id=entry.targets.interview.pageId;
 const found=pages.filter(p=>(p.properties['内容']?.title??[]).some(t=>sameNotionId(t.mention?.page?.id,id)));
 if(found.length>1)throw new InterviewError('同じ面談記録を案内する報告が複数あります。職員の確認が必要です。',409);
 return found[0];
}
// Each checkpoint is durable BEFORE a non-idempotent request. After an uncertain
// create/append, reconcile our visible provenance link before making another one.
export async function runEnrollmentEntry({entry,request,checkpoint}){
 const schemas=await enrollmentSchemas(request);
 const save=async(status='running')=>{if(!await checkpoint(entry.targets,status))throw new InterviewError('保存処理の版が変わりました。最新の状態を確認してください。',409);};
 let transient=false;
 for(const target of ['interview','student','intake','mtg']){
  const state=entry.targets[target];if(state.status==='synced')continue;
  try{
   if(target==='intake'&&!state.pageId)throw new InterviewError('受付の記録を一意に特定できません。入力画面で対象の受付を選択してください。',409);
   if(['interview','mtg'].includes(target)&&entry.payload.actorIssue)throw new InterviewError(entry.payload.actorIssue,409);
   if(target==='interview'&&!entry.payload.record)throw new InterviewError('詳しい記録を入力してください。',409);
   if(target==='mtg'&&entry.targets.interview.status!=='synced')throw new InterviewError('面談記録の反映後にリンクを登録します。面談記録の確認事項を先に解消してください。',409);
   let page;
   if(state.pageId)page=await enrollmentPage(request,state.pageId,target);
   const desired=desiredEnrollmentProperties(entry.payload,target,schemas[target],entry.payload.actorPageId,entry.targets.interview.pageId);
   if(target==='intake'&&schemas.intake.properties['notion生徒情報']?.type==='checkbox'&&entry.targets.interview.status==='synced'&&entry.targets.student.status==='synced'&&['admissionDate','procedureDate','interviewDate','method','grade','campus','studentStatus','homeroom','studentNumber'].every(k=>['confirmed','not_applicable'].includes(entry.payload.fields[k]?.state)))desired['notion生徒情報']={checkbox:true};
   if(!page){
    page=target==='interview'?await findInterview(request,entry):await findMtg(request,entry);
    if(page){state.pageId=page.id;state.baseline=propertyBaseline(page);}
    else if(state.createAttempted){throw new InterviewError('前回の登録結果を確認できません。重複登録を防ぐため、Notionの原本を確認してから「反映を再確認」を押してください。',409);}
    else{
     state.createAttempted=true;state.status='creating';await save();
     page=await request('/pages',{method:'POST',body:JSON.stringify({parent:{type:'data_source_id',data_source_id:sources[target]},properties:desired,...(target==='interview'?{children:recordBlocks(entry)}:{})})});
     state.pageId=page.id;state.baseline=propertyBaseline(page);if(target==='interview')state.recordVersion=entry.version;
     await save();
    }
   }
   const patch=safePropertyPatch(page,desired,state.baseline??{});
   if(Object.keys(patch).length){state.status='updating';await save();page=await request(`/pages/${page.id}`,{method:'PATCH',body:JSON.stringify({properties:patch})});}
   state.baseline=propertyBaseline(page);
   if(target==='interview'&&state.recordVersion!==entry.version){
    const blocks=await allBlocks(request,page.id);
    if(!hasMarker(blocks,entry)){
     if(state.appendAttempted===entry.version)throw new InterviewError('追記の結果を確認できません。原本を確認してから「反映を再確認」を押してください。',409);
     state.appendAttempted=entry.version;await save();await request(`/blocks/${page.id}/children`,{method:'PATCH',body:JSON.stringify({children:recordBlocks(entry)})});
    }
    state.recordVersion=entry.version;
   }
   const verified=await enrollmentPage(request,page.id,target);
   for(const [name,value]of Object.entries(desired))if(JSON.stringify(propertyComparable(verified.properties[name]))!==JSON.stringify(propertyComparable(value)))throw new InterviewError(`「${name}」の反映結果を確認できません。原本を確認してください。`,409);
   if(target==='interview'&&!hasMarker(await allBlocks(request,page.id),entry))throw new InterviewError('面談本文の反映を確認できません。',409);
   state.baseline=propertyBaseline(verified);state.status='synced';state.error='';state.url=verified.url??`https://www.notion.so/${page.id.replaceAll('-','')}`;
  }catch(e){
   state.status=e instanceof InterviewError?'review':'retry';state.error=e instanceof InterviewError?e.message:'Notionとの通信を完了できませんでした。保存した入力は保持し、自動で再確認します。';
   if(state.status==='retry')transient=true;
  }
  await save();
 }
 const review=Object.values(entry.targets).some(s=>s.status!=='synced')||pendingEnrollmentFields(entry.payload).length>0;
 await save(transient?'partial':review?'review':'complete');
 return {targets:entry.targets,status:transient?'partial':review?'review':'complete'};
}
