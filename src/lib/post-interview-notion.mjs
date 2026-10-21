import {InterviewError} from './interview-core.mjs';
import {queryPages} from './bensuke-booking.mjs';
import {digest,sameNotionId,propertyText,propertyComparable,safePropertyPatch,typedNotionValue} from './enrollment-core.mjs';
import {propertyBaseline,enrollmentStaffOptions,enrollmentActor} from './enrollment-notion.mjs';
import {RECORD_SOURCE,postFields,seedPostFields,confirmed} from './post-interview-core.mjs';
import {notionRecordText} from './survey-workflow-core.mjs';
import {parentContactTeacherName} from './parent-contact-core.mjs';
export async function postBlocks(request,id){let cursor='',rows=[];for(let i=0;i<10;i++){const data=await request(`/blocks/${id}/children?page_size=100${cursor?'&start_cursor='+encodeURIComponent(cursor):''}`);rows.push(...data.results);if(!data.has_more)return rows;cursor=data.next_cursor;if(!cursor)break;}throw new InterviewError('既存の本文を全件確認できません。',409);}
const text=items=>(items??[]).map(x=>x.plain_text??x.text?.content??'').join('');
const blockText=block=>text(block[block.type]?.rich_text);
const signature=blocks=>digest(blocks.map(b=>({id:b.id,edited:b.last_edited_time,text:blockText(b),children:b.has_children})));
const marker=(id,version)=>`勉たん面談後の入力:${id}:${version}`;
const hasMarker=(blocks,id,version)=>blocks.some(b=>b.type==='code'&&text(b.code.caption)===marker(id,version));
const hasCase=(blocks,id)=>blocks.some(b=>b.type==='code'&&text(b.code.caption).startsWith(`勉たん面談後の入力:${id}:`));
const latestBody=(blocks,id)=>blocks.filter(b=>b.type==='code'&&text(b.code.caption).startsWith(`勉たん面談後の入力:${id}:`)).map(blockText).at(-1);
export async function postRecordPage(request,id,studentId){const page=await request('/pages/'+id);if(page.archived||page.in_trash||!sameNotionId(page.parent?.data_source_id,RECORD_SOURCE)||page.properties['生徒情報DB']?.relation?.length!==1||!sameNotionId(page.properties['生徒情報DB'].relation[0].id,studentId))throw new InterviewError('面談記録と生徒が一致しません。',409);return page;}
export async function postRecordCandidates(request,studentId){return queryPages(request,RECORD_SOURCE,{property:'生徒情報DB',relation:{contains:studentId}},8);}
export async function preparePostContext({request,verified,entry,recordId,staff}){
 const {answer,profile,student,method}=verified;
 const [schema,candidates]=await Promise.all([request('/data_sources/'+RECORD_SOURCE),postRecordCandidates(request,profile.id)]);
 const id=entry?.targets?.record?.pageId??recordId??'';const record=id?await postRecordPage(request,id,profile.id):null;
 const blocks=record?await postBlocks(request,record.id):[];
 const staffOptions=await enrollmentStaffOptions(request,schema);let author='';try{author=await enrollmentActor(request,schema,staff,staffOptions);}catch{}
 const legacy=blocks.filter(b=>!['code'].includes(b.type)||!text(b.code?.caption).startsWith('勉たん面談後の入力:')).map(blockText).filter(Boolean).join('\n\n');
 const owned=entry?blocks.filter(b=>b.type==='code'&&text(b.code?.caption).startsWith(`勉たん面談後の入力:${entry.id}:`)).at(-1):null;
 const recordText=owned?blockText(owned):legacy;
 const payload=entry?{...entry.payload,recordPageId:record?.id??''}:{answerId:answer.id,studentPageId:profile.id,recordPageId:record?.id??'',sourceText:'',participants:'',fields:seedPostFields({record,survey:answer,recordText,grade:String(student.grade??''),method,author})};
 if(!payload.workLog)payload.workLog={enabled:true,teacher:parentContactTeacherName(staff),task:'',start:'',end:'',contact:[student.grade,student.student_name].filter(Boolean).join(' '),content:'',result:''};
 const snapshots={record:record?{pageId:record.id,baseline:propertyBaseline(record),blocks:signature(blocks)}:{pageId:'',baseline:{},blocks:signature([])},survey:{pageId:answer.id,baseline:propertyBaseline(answer)}};
 return {payload,entry,student:{id:profile.id,name:student.student_name,number:student.student_number,grade:student.grade},survey:{id:answer.id,url:answer.url,preparation:propertyText(answer.properties['面談準備']),handling:propertyText(answer.properties['対応']),date:verified.date},
  records:candidates.map(p=>({id:p.id,title:propertyText(p.properties['面談内容']),date:propertyText(p.properties['面談日']),url:p.url})).sort((a,b)=>b.date.localeCompare(a.date)),
  originalBody:legacy,originalUrl:record?.url??'',staffOptions,options:Object.fromEntries(postFields.filter(f=>f.property&&['select','multi_select'].includes(schema.properties[f.property]?.type)).map(f=>[f.key,schema.properties[f.property][schema.properties[f.property].type].options.map(o=>o.name)])),snapshots,snapshot:digest(snapshots)};
}
export function postDesiredProperties(payload,schema){const desired={};for(const f of postFields){const value=confirmed(payload,f.key);if(!f.property||!value)continue;
 if(f.key==='author'){desired[f.property]={relation:[{id:value}]};continue;}
 desired[f.property]=typedNotionValue(schema,f.property,value);
 }desired['生徒情報DB']={relation:[{id:payload.studentPageId}]};return desired;}
export function postSurveyProperties(schema,value){
 const desired={対応:typedNotionValue(schema,'対応',value)};
 if(value==='対応済'){
  const property=schema.properties['面談準備'];const option=property?.type==='status'&&property.status.options.find(o=>o.name==='完了');
  if(!option)throw new InterviewError('Notionの「面談準備」の「完了」を確認してください。対応の反映も保留しました。',409);
  desired['面談準備']={status:{id:option.id}};
 }
 return desired;
}
function recordChildren(entry){return [{object:'block',type:'code',code:{language:'plain text',caption:[{type:'text',text:{content:marker(entry.id,entry.version)}}],rich_text:notionRecordText(confirmed(entry.payload,'record'))}}];}
async function recoverRecord(request,entry){const found=[];for(const page of await postRecordCandidates(request,entry.payload.studentPageId)){if(hasCase(await postBlocks(request,page.id),entry.id))found.push(page);}if(found.length>1)throw new InterviewError('同じ入力に対応する記録が複数あります。',409);return found[0];}
export async function runPostNotion({entry,request,checkpoint}){
 const save=async()=>{if(!await checkpoint(entry.targets,'running'))throw new InterviewError('処理の版が変わりました。',409);};
 const schema=await request('/data_sources/'+RECORD_SOURCE);
 for(const kind of ['record','survey']){const state=entry.targets[kind];if(['synced','skipped'].includes(state.status))continue;
  try{
   if(kind==='survey'){
    const value=confirmed(entry.payload,'handling');if(!value){state.status='review';state.error='アンケートの対応を確認後、確定にしてください。';await save();continue;}
    const page=await request('/pages/'+entry.payload.answerId);if(page.archived||page.in_trash||!sameNotionId(page.parent?.data_source_id,entry.payload.answerSourceId))throw new InterviewError('回答の原本が変わっています。',409);
    const relation=page.properties['生徒情報DB']?.relation??[];if(relation.length!==1||!sameNotionId(relation[0].id,entry.payload.studentPageId))throw new InterviewError('回答の生徒対応を再確認してください。',409);
    const surveySchema=value==='対応済'?await request('/data_sources/'+entry.payload.answerSourceId):entry.payload.surveySchema;
    const desired=postSurveyProperties(surveySchema,value);
    // Older saved entries predate status-property snapshots. Only seed this newly managed property.
    const baseline={...state.baseline};if(value==='対応済'&&baseline['面談準備']==null)baseline['面談準備']=propertyComparable(page.properties['面談準備']);
    const patch=safePropertyPatch(page,desired,baseline);
    if(Object.keys(patch).length){await save();await request('/pages/'+page.id,{method:'PATCH',body:JSON.stringify({properties:patch})});}
    const checked=await request('/pages/'+page.id);for(const [name,value]of Object.entries(desired))if(JSON.stringify(propertyComparable(checked.properties[name]))!==JSON.stringify(propertyComparable(value)))throw new InterviewError(`「${name}」の反映を確認できません。`,409);
    state.status='synced';state.baseline=propertyBaseline(checked);state.error='';state.url=page.url;await save();continue;
   }
   const desired=postDesiredProperties(entry.payload,schema),body=confirmed(entry.payload,'record');
   let page=state.pageId?await postRecordPage(request,state.pageId,entry.payload.studentPageId):await recoverRecord(request,entry);
   if(!page){
    if(state.createAttempted)throw new InterviewError('前回の新規登録結果を確認できません。再作成せず原本を確認してください。',409);
    const missing=[['title','面談の見出し'],['date','実施日'],['record','Notion用の面談記録']].filter(([key])=>!confirmed(entry.payload,key)?.trim()).map(([,label])=>label);
    if(missing.length)throw new InterviewError(`新しい面談記録の作成を保留しています。「${missing.join('」「')}」を入力し、判断の状態を「確定」にしてください。${missing.includes('Notion用の面談記録')?'「面談の原文・補足」は別欄です。AIで候補を作るか、原文を記録本文として採用してください。':''}`,409);
    state.createAttempted=true;state.status='creating';await save();page=await request('/pages',{method:'POST',body:JSON.stringify({parent:{type:'data_source_id',data_source_id:RECORD_SOURCE},properties:desired,children:recordChildren(entry)})});state.pageId=page.id;state.baseline=propertyBaseline(page);await save();
   }
   state.pageId=page.id;
   const patch=safePropertyPatch(page,desired,state.baseline??{});if(Object.keys(patch).length){await save();page=await request('/pages/'+page.id,{method:'PATCH',body:JSON.stringify({properties:patch})});}
   const blocks=await postBlocks(request,page.id);
   if(body&&!hasMarker(blocks,entry.id,entry.version)&&latestBody(blocks,entry.id)!==body){
    const existingText=blocks.map(blockText).filter(Boolean).join('\n\n');
    // An imported legacy body that was not edited needs no duplicate block.
    if(body!==entry.payload.originalBody||body!==existingText){
     if(state.appendAttempted===entry.version)throw new InterviewError('本文追記の結果を確認できません。原本を確認してください。',409);
     if(state.blocks&&signature(blocks)!==state.blocks)throw new InterviewError('面談の本文が編集されています。入力を保持して最新内容を確認してください。',409);
     state.appendAttempted=entry.version;await save();await request('/blocks/'+page.id+'/children',{method:'PATCH',body:JSON.stringify({children:recordChildren(entry)})});
    }
   }
   const checked=await postRecordPage(request,page.id,entry.payload.studentPageId);for(const [name,value]of Object.entries(desired))if(JSON.stringify(propertyComparable(checked.properties[name]))!==JSON.stringify(propertyComparable(value)))throw new InterviewError('面談項目の反映を確認できません。',409);
   const checkedBlocks=await postBlocks(request,page.id);if(body&&!hasMarker(checkedBlocks,entry.id,entry.version)&&latestBody(checkedBlocks,entry.id)!==body&&body!==checkedBlocks.map(blockText).filter(Boolean).join('\n\n'))throw new InterviewError('本文の反映を確認できません。',409);
   state.baseline=propertyBaseline(checked);state.blocks=signature(checkedBlocks);state.url=checked.url;state.status='synced';state.error='';
  }catch(error){state.status=error instanceof InterviewError?'review':'retry';state.error=error instanceof InterviewError?error.message:'Notionとの通信結果を再確認しています。';}
  await save();
 }
}
