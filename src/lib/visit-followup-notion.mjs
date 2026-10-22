import {InterviewError} from './interview-core.mjs';
import {ENROLLMENT_SOURCES as sources,propertyText,sameNotionId,isEnrollmentId,digest} from './enrollment-core.mjs';
import {enrollmentSchemas,enrollmentPage,intakeCandidates,enrollmentStaffOptions,enrollmentActor} from './enrollment-notion.mjs';
import {queryPages} from './bensuke-booking.mjs';
import {blankVisitFields,visitKnown,visitBaseline,visitSnapshot,visitPatch,visitProperties} from './visit-followup-core.mjs';
const kinds={record:'interview',student:'student',intake:'intake',mtg:'mtg'};
const marker=(entry,version=entry.version)=>`https://line-check-system.vercel.app/staff/visit-followup?entry=${entry.id}&revision=${version}`;
async function blocks(request,id){let cursor='',rows=[];for(let i=0;i<20;i++){const r=await request(`/blocks/${id}/children?page_size=100${cursor?'&start_cursor='+encodeURIComponent(cursor):''}`);rows.push(...r.results);if(!r.has_more)return rows;cursor=r.next_cursor;if(!cursor)break;}throw new InterviewError('面談本文の全件を確認できません。',409);}
const hasMarker=(rows,url)=>rows.some(b=>(b[b.type]?.rich_text??[]).some(t=>t.text?.link?.url===url));
const writableText=items=>items.map(item=>({type:item.type,...(item.type==='mention'?{mention:item.mention}:item.type==='equation'?{equation:item.equation}:{text:item.text}),...(item.annotations?{annotations:item.annotations}:{})}));
function recordBlocks(entry){const text=entry.payload.record;return [{object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:`見学打合せの入力記録（保存版 ${entry.version}）`,link:{url:marker(entry)}}}]}},...Array.from({length:Math.ceil(text.length/1800)},(_,i)=>({object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:text.slice(i*1800,(i+1)*1800)}}]}}))];}
function verifyStudentRelation(page,studentId,property='生徒情報DB'){
 const relation=page.properties[property];if(relation?.has_more||relation?.relation?.length!==1||!sameNotionId(relation.relation[0].id,studentId))throw new InterviewError('選択した記録の生徒が一致しません。対象を選び直してください。',409);
}
export async function prepareVisit({request,studentPageId,intakePageId='',recordSelection='',prior=null,staff}){
 const schemas=await enrollmentSchemas(request),student=await enrollmentPage(request,studentPageId,'student'),intakes=await intakeCandidates(request,student.id);
 if(intakes.some(p=>p.properties['生徒情報DB']?.has_more))throw new InterviewError('受付と生徒の関係を全件確認できません。',409);
 // An ambiguous or previously cleared choice must stay unselected.
 const intake=intakes.find(p=>sameNotionId(p.id,intakePageId))??(!intakePageId&&!prior&&intakes.length===1?intakes[0]:null);
 if(intakePageId&&!intake)throw new InterviewError('選択した受付がこの生徒に対応しません。',409);
 if(intake)verifyStudentRelation(intake,student.id);
 const records=await queryPages(request,sources.interview,{property:'生徒情報DB',relation:{contains:student.id}},5);
 let record=null,originalBody='';
 const recordId=prior?.targets.record?.pageId??recordSelection;
 if(isEnrollmentId(recordId)){record=await enrollmentPage(request,recordId,'interview');verifyStudentRelation(record,student.id);originalBody=(await blocks(request,record.id)).map(b=>(b[b.type]?.rich_text??[]).map(t=>t.plain_text??t.text?.content??'').join('')).filter(Boolean).join('\n\n');}
 const staffOptions=await enrollmentStaffOptions(request,schemas.interview),actorPageId=await enrollmentActor(request,schemas.interview,staff,staffOptions);
 if(!sameNotionId(schemas.intake.properties['見打ち担当者']?.relation?.data_source_id,schemas.interview.properties['記入者']?.relation?.data_source_id))throw new InterviewError('見学打合せ担当者の接続先を確認してください。',409);
 const options={method:schemas.interview.properties['方法'].select.options.map(o=>o.name),grade:schemas.interview.properties['面談時の学年'].select.options.map(o=>o.name),campus:schemas.mtg.properties['校舎'].multi_select.options.map(o=>o.name),classes:schemas.intake.properties['見学クラス'].multi_select.options.map(o=>o.name),visitStaff:staffOptions.map(o=>o.id),studentStatus:schemas.student.properties['状態'].select.options.map(o=>o.name),intakeStatus:schemas.intake.properties['状態（問合DBのみの）'].select.options.map(o=>o.name)};
 const targets={};for(const target of ['record','student','intake','mtg']){
  const old=prior?.targets[target]??{};let page=target==='student'?student:target==='intake'?intake:target==='record'?record:null;
  if(target==='mtg'&&old.pageId){page=await enrollmentPage(request,old.pageId,'mtg');verifyStudentRelation(page,student.id,'生徒名');}
  targets[target]={...old,pageId:page?.id??null,baseline:visitBaseline(page)};
 }
 const grade=propertyText(student.properties['学年']).replace(/[0-9]/g,c=>'０１２３４５６７８９'[Number(c)]);
 const fields=blankVisitFields();for(const [key,value]of [['method',''],['grade',grade],['campus',propertyText(student.properties['所属'])],['title','見学打合せ'],['reportTitle','見学開始の報告'],['studentStatus','見学中'],['intakeStatus','見学中']])if(value)fields[key]={value,state:'review'};
 const payload={studentPageId:student.id,intakePageId:intake?.id??'',recordSelection,fields,record:'',intakeNote:'',workLog:{enabled:false,teacher:'',task:'',start:'',end:'',contact:'',content:'',result:''}};
 const currentValues=Object.fromEntries([[student,'生徒情報',['見学開始','見学終了','見学期間']],[intake,'受付',['見学開始日','見学終了日','見学クラス','見学用教材配布','Zoom設定','公式LINE登録']]].flatMap(([page,label,names])=>names.map(name=>{const p=page?.properties[name];return [`${label}：${name}`,p?.type==='date'?[p.date?.start,p.date?.end].filter(Boolean).join(' ～ '):propertyText(p)];})));
 return {payload,targets,actorPageId,snapshot:visitSnapshot(targets),staffOptions,options,originalBody,currentValues,student:{id:student.id,name:propertyText(student.properties['生徒氏名']),number:propertyText(student.properties['学籍番号']),status:propertyText(student.properties['状態']),url:student.url},intakes:intakes.map(p=>({id:p.id,title:propertyText(p.properties['問合せ内容']),status:propertyText(p.properties['状態（問合DBのみの）']),note:propertyText(p.properties['見学打合せ時の備考']),url:p.url})),records:records.map(p=>({id:p.id,title:propertyText(p.properties['面談内容']),date:propertyText(p.properties['面談日']),url:p.url}))};
}
export async function runVisitNotion({entry,request,checkpoint}){
 const schemas=await enrollmentSchemas(request),schemaFor=key=>schemas[kinds[key]];
 const save=async()=>{if(!await checkpoint(entry.targets,'running'))throw new InterviewError('保存版が変わったため反映を停止しました。',409);};
 for(const target of ['record','student','intake','mtg']){
  const state=entry.targets[target];if(!state||['synced','skipped'].includes(state.status))continue;
  try{
   if(target==='record'&&(!entry.payload.record||!['date','title','method','grade'].every(key=>visitKnown(entry.payload,key))))throw new InterviewError('面談の実施日・見出し・方法・学年・本文を確認して確定してください。',409);
   if(target==='intake'&&!state.pageId)throw new InterviewError('対象の受付を明示して選択してください。',409);
   if(target==='mtg'&&(entry.targets.record.status!=='synced'||!visitKnown(entry.payload,'reportTitle')||!visitKnown(entry.payload,'date')))throw new InterviewError('面談記録の反映とMTG見出し・実施日の確定を先に確認してください。',409);
   let page=state.pageId?await enrollmentPage(request,state.pageId,kinds[target]):null;
   if(page&&target==='record')verifyStudentRelation(page,entry.student_page_id);
   if(page&&target==='intake')verifyStudentRelation(page,entry.student_page_id);
   if(page&&target==='mtg')verifyStudentRelation(page,entry.student_page_id,'生徒名');
   let desired=visitProperties(entry.payload,target,schemaFor(target),entry.payload.actorPageId,entry.targets.record.pageId);
   if(!page){
    const candidates=await queryPages(request,sources[kinds[target]],{property:target==='record'?'生徒情報DB':'生徒名',relation:{contains:entry.student_page_id}},5),found=[];
    for(const candidate of candidates){if((await blocks(request,candidate.id)).some(b=>(b[b.type]?.rich_text??[]).some(t=>t.text?.link?.url?.startsWith(`https://line-check-system.vercel.app/staff/visit-followup?entry=${entry.id}&revision=`))))found.push(candidate);}
    if(found.length>1)throw new InterviewError('同じ入力記録の反映先が複数あります。原本を確認してください。',409);
    page=found[0];
    if(!page){
     if(state.createAttempted)throw new InterviewError('前回の登録結果が不明です。重複を防ぐため原本の確認を保留しています。',409);
     state.status='creating';state.createAttempted=true;await save();
     page=await request('/pages',{method:'POST',body:JSON.stringify({parent:{type:'data_source_id',data_source_id:sources[kinds[target]]},properties:desired,children:target==='record'?recordBlocks(entry):[recordBlocks(entry)[0]]})});
     if(target==='record')state.recordVersion=entry.version;
    }
    state.pageId=page.id;state.baseline=visitBaseline(page);await save();
   }
   if(target==='intake'){
    // Keep an existing planned time when the explicitly entered date is the same day.
    if(desired['見学打合せ日']&&page.properties['見学打合せ日']?.date?.start?.slice(0,10)===visitKnown(entry.payload,'date'))desired['見学打合せ日']={date:page.properties['見学打合せ日'].date};
    const current=page.properties['見学打合せ時の備考']?.rich_text??[];
    if((entry.payload.intakeNote||entry.targets.record.status==='synced')&&!current.some(t=>t.text?.link?.url===marker(entry))){
     const extra=[{type:'text',text:{content:(current.length?'\n':'')+`見学打合せの記録（保存版 ${entry.version}）`,link:{url:marker(entry)}}}];
     if(entry.payload.intakeNote)for(let i=0;i<entry.payload.intakeNote.length;i+=1800)extra.push({type:'text',text:{content:(i===0?'\n':'')+entry.payload.intakeNote.slice(i,i+1800)}});
     if(entry.targets.record.status==='synced')extra.push({type:'mention',mention:{type:'page',page:{id:entry.targets.record.pageId}}});
     if(current.length+extra.length>100)throw new InterviewError('受付備考の上限に近いため追記を保留しました。原本を確認してください。',409);
     desired={...desired,'見学打合せ時の備考':{rich_text:[...writableText(current),...extra]}};
    }
    if(entry.targets.student.status!=='synced'&&desired.notion生徒情報?.checkbox===true)throw new InterviewError('生徒情報の反映を確認してから、Notion生徒情報の確認済みを登録します。',409);
   }
   if(!Object.keys(desired).length){state.status='skipped';state.error='';await save();continue;}
   const patch=visitPatch(page,desired,state.baseline??{});
   if(Object.keys(patch).length){state.status='updating';await save();page=await request('/pages/'+page.id,{method:'PATCH',body:JSON.stringify({properties:patch})});}
   state.baseline=visitBaseline(page);
   if(target==='record'&&state.recordVersion!==entry.version){const existing=await blocks(request,page.id);if(!hasMarker(existing,marker(entry))){if(state.appendAttempted===entry.version)throw new InterviewError('本文追記の結果が不明です。原本を確認してください。',409);state.appendAttempted=entry.version;await save();await request('/blocks/'+page.id+'/children',{method:'PATCH',body:JSON.stringify({children:recordBlocks(entry)})});}state.recordVersion=entry.version;}
   const verified=await enrollmentPage(request,page.id,kinds[target]);
   if(Object.keys(visitPatch(verified,desired,visitBaseline(verified))).length)throw new InterviewError('反映結果を確認できません。入力を保持して再確認します。',503);
   if(target==='record'&&!hasMarker(await blocks(request,page.id),marker(entry)))throw new InterviewError('面談本文の反映結果を確認できません。',503);
   state.baseline=visitBaseline(verified);state.status='synced';state.error='';state.url=verified.url??`https://www.notion.so/${page.id.replaceAll('-','')}`;
   state.fingerprint=digest({fields:entry.payload.fields,record:entry.payload.record,intakeNote:entry.payload.intakeNote});
  }catch(error){state.status=error instanceof InterviewError&&error.status<500?'review':'retry';state.error=error instanceof InterviewError?error.message:'Notionとの通信結果を再確認します。入力は勉たんに保存されています。';}
  await save();
 }
}
