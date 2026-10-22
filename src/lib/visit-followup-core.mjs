import {InterviewError} from './interview-core.mjs';
import {digest,isEnrollmentId,typedNotionValue,propertyComparable} from './enrollment-core.mjs';
import {isValidReservationDate} from './reservation-date.mjs';
import {normalizeParentWorkLog} from './parent-contact-core.mjs';
export const VISIT_WORKFLOW='visit-followup';
export const visitFields=[
 {key:'date',label:'打ち合わせの実施日',type:'date',group:'record'},
 {key:'title',label:'面談記録の見出し',type:'text',group:'record'},
 {key:'method',label:'実際の面談方法',type:'select',group:'record'},
 {key:'grade',label:'面談時の学年',type:'select',group:'record'},
 {key:'campus',label:'校舎',type:'select',group:'visit'},
 {key:'visitStart',label:'見学開始日',type:'date',group:'visit'},
 {key:'visitEnd',label:'見学終了日',type:'date',group:'visit'},
 {key:'classes',label:'見学クラス',type:'multi',group:'visit'},
 {key:'visitStaff',label:'見学打合せの担当者',type:'staff',group:'visit'},
 {key:'studentStatus',label:'生徒情報の状態',type:'select',group:'visit'},
 {key:'intakeStatus',label:'受付側の状態',type:'select',group:'visit'},
 {key:'materials',label:'見学用教材配布',type:'check',property:'見学用教材配布',group:'checks'},
 {key:'zoom',label:'Zoom設定',type:'check',property:'Zoom設定',group:'checks'},
 {key:'line',label:'公式LINE登録',type:'check',property:'公式LINE登録',group:'checks'},
 {key:'notionStudent',label:'Notion生徒情報の確認',type:'check',property:'notion生徒情報',group:'checks'},
 {key:'paper',label:'受付簿の記入・印刷',type:'check',group:'checks'},
 {key:'reportTitle',label:'終業MTGの見出し',type:'text',group:'report'},
];
export const visitKnown=(payload,key)=>payload.fields[key]?.state==='confirmed'?payload.fields[key].value:undefined;
export const blankVisitFields=()=>Object.fromEntries(visitFields.map(f=>[f.key,{value:'',state:'unknown'}]));
export function validateVisitPayload(input,options={}){
 if(!input||!isEnrollmentId(input.studentPageId)||input.intakePageId&&!isEnrollmentId(input.intakePageId)||!['new',''].includes(input.recordSelection)&&!isEnrollmentId(input.recordSelection))throw new InterviewError('生徒・受付・面談記録の選択を確認してください。',422);
 const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw new InterviewError('入力の形式・文字数を確認してください。',422);return v.trim();};
 const fields=blankVisitFields();
 for(const f of visitFields){
  const item=input.fields?.[f.key];if(!item||!['unknown','review','confirmed','not_applicable'].includes(item.state))throw new InterviewError('各項目の確認状態を選択してください。',422);
  const value=text(item.value??'',f.type==='multi'?3000:f.type==='text'?500:100);
  if(item.state==='confirmed'){
   if(!value)throw new InterviewError(`${f.label}を入力してください。`,422);
   if(f.type==='date'&&!isValidReservationDate(value))throw new InterviewError(`${f.label}の日付を確認してください。`,422);
   if(f.type==='check'&&!['済','未実施'].includes(value))throw new InterviewError(`${f.label}の実施結果を選択してください。`,422);
   const selected=f.type==='multi'?value.split('、').filter(Boolean):[value];
   if(['select','multi','staff'].includes(f.type)&&(!options[f.key]||selected.some(v=>!options[f.key].includes(v))))throw new InterviewError(`${f.label}を原本の選択肢から選び直してください。`,422);
  }
  fields[f.key]={value,state:item.state};
 }
 const start=visitKnown({fields},'visitStart'),end=visitKnown({fields},'visitEnd');
 if(start&&end&&start>end)throw new InterviewError('見学終了日は開始日以降にしてください。',422);
 return {workflow:VISIT_WORKFLOW,studentPageId:input.studentPageId,answerId:input.studentPageId,intakePageId:input.intakePageId??'',recordSelection:input.recordSelection??'',fields,record:text(input.record??'',16000),intakeNote:text(input.intakeNote??'',3000),workLog:normalizeParentWorkLog(input.workLog)};
}
export function visitComparable(p){
 if(p?.date!==undefined)return {date:p.date?{start:p.date.start,end:p.date.end??null,time_zone:p.date.time_zone??null}:null};
 if(p?.rich_text)return {rich_text:p.rich_text.map(t=>({...((t.type==='mention')?{mention:t.mention}:t.type==='equation'?{equation:t.equation}:{text:t.text?.content??t.plain_text??'',link:t.text?.link?.url??null}),annotations:{bold:t.annotations?.bold??false,italic:t.annotations?.italic??false,strikethrough:t.annotations?.strikethrough??false,underline:t.annotations?.underline??false,code:t.annotations?.code??false,color:t.annotations?.color??'default'}}))};
 return propertyComparable(p);
}
export const visitBaseline=page=>Object.fromEntries(Object.entries(page?.properties??{}).map(([key,value])=>[key,visitComparable(value)]));
export const visitSnapshot=targets=>digest(Object.fromEntries(Object.entries(targets).filter(([k])=>['record','student','intake','mtg'].includes(k)).map(([key,state])=>[key,{pageId:state.pageId??'',baseline:state.baseline??{}}])));
export function visitPatch(page,desired,baseline){
 const patch={};for(const [name,value]of Object.entries(desired)){
  const current=visitComparable(page.properties[name]),next=visitComparable(value);
  if(JSON.stringify(current)===JSON.stringify(next))continue;
  if(JSON.stringify(current)!==JSON.stringify(baseline[name]??null))throw new InterviewError(`Notionの「${name}」が更新されています。原本を再確認してください。`,409);
  patch[name]=value;
 }return patch;
}
export function visitProperties(payload,target,schema,actorPageId,recordPageId){
 const properties={},known=key=>visitKnown(payload,key),put=(name,key)=>{const value=known(key);if(value!==undefined)properties[name]=typedNotionValue(schema,name,value);};
 if(target==='record'){
  properties['生徒情報DB']={relation:[{id:payload.studentPageId}]};put('面談内容','title');put('面談日','date');put('方法','method');put('面談時の学年','grade');
  properties['面談目的']=typedNotionValue(schema,'面談目的','見学打合せ');properties['記入者']={relation:[{id:actorPageId}]};
 }
 if(target==='student'){
  put('状態','studentStatus');put('見学開始','visitStart');put('見学終了','visitEnd');
  if(known('visitStart')&&known('visitEnd'))properties['見学期間']={date:{start:known('visitStart'),end:known('visitEnd')}};
 }
 if(target==='intake'){
  put('状態（問合DBのみの）','intakeStatus');put('見学開始日','visitStart');put('見学終了日','visitEnd');put('見学クラス','classes');put('見打ち担当者','visitStaff');
  put('見学打合せ日','date');
  for(const field of visitFields.filter(f=>f.property))put(field.property,field.key);
 }
 if(target==='mtg'){
  if(!recordPageId)throw new InterviewError('面談記録の反映を先に確認してください。',409);
  properties['生徒名']={relation:[{id:payload.studentPageId}]};properties['内容']={title:[{type:'mention',mention:{type:'page',page:{id:recordPageId}}},{type:'text',text:{content:' 詳細はこちら'}}]};
  put('見出し','reportTitle');put('日付','date');put('面談日','date');put('校舎','campus');put('方法','method');put('面談時の学年','grade');
  properties['面談目的']=typedNotionValue(schema,'面談目的','見学打合せ');properties['報告者']={relation:[{id:actorPageId}]};
 }
 return properties;
}
