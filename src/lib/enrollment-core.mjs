import {createHash} from 'node:crypto';
import {isValidReservationDate} from './reservation-date.mjs';
import {InterviewError} from './interview-core.mjs';

export const ENROLLMENT_SOURCES={student:'19ef0120-80a7-80b7-9f23-000b21e0a53b',intake:'1adf0120-80a7-805e-9584-000be0236d67',interview:'19ef0120-80a7-808a-8992-000b85713577',mtg:'1a6f0120-80a7-80df-91ca-000b94d22ca3'};
export const enrollmentFields=[
 {key:'admissionDate',label:'入塾日',type:'date',target:'student',property:'本当の入塾日'},
 {key:'procedureDate',label:'手続き日',type:'date',target:'student',property:'入塾手続日'},
 {key:'procedureStaff',label:'手続担当者',type:'staff',target:'intake',property:'手続担当者'},
 {key:'interviewDate',label:'面談日',type:'date'},
 {key:'method',label:'面談の方法',type:'select',options:['２者対面','３者対面','４者対面','2者Zoom','３者Zoom','４者Zoom','電話','LINE','メール']},
 {key:'grade',label:'面談時の学年',type:'select',options:['小３','小４','小５','小６','中１','中２','中３','高１','高２','高３']},
 {key:'campus',label:'校舎',type:'select',options:['本校','南教室']},
 {key:'studentStatus',label:'生徒の在籍状態',type:'select',target:'student',property:'状態',options:['新規問合せ','見学中','入会表明','在塾','退塾','卒塾','資料請求','キャンセル','お断り','休塾']},
 {key:'homeroom',label:'担任',type:'text',target:'student',property:'担任'},
 {key:'studentNumber',label:'学籍番号',type:'text',target:'student',property:'学籍番号'},
 {key:'intakeStatus',label:'受付側の状態',type:'select',target:'intake',property:'状態（問合DBのみの）',options:['新規問合せ','見学中','入塾表明あり','入塾手続き完了','キャンセル','お断り','未着手','復塾希望','再問合せ','見学期間終了']},
 {key:'classes',label:'入塾時のクラス',type:'text',target:'intake',property:'入塾時のクラス',hint:'Notionのクラス名を読点「、」で区切る。判断できない場合は要確認。'},
 {key:'intakeNote',label:'入塾手続き時の備考',type:'text',target:'intake',property:'入塾手続き時の備考'},
 {key:'documents',label:'入塾申込書',type:'check',target:'intake',property:'入塾申込書'},
 {key:'bankForm',label:'振替依頼書',type:'check',target:'intake',property:'振替依頼書'},
 {key:'admissionFee',label:'入会金受領',type:'check',target:'intake',property:'入会金受領'},
 {key:'photo',label:'顔写真撮影',type:'check',target:'intake',property:'生徒顔写真'},
 {key:'materials',label:'入会教材配布',type:'check',target:'intake',property:'入会教材配布'},
 {key:'line',label:'公式LINE登録',type:'check',target:'intake',property:'公式LINE登録'},
 {key:'classList',label:'benkoクラス一覧',type:'check',target:'intake',property:'benkoクラス一覧'},
 {key:'instruction',label:'指導簿登録',type:'check',target:'intake',property:'指導簿登録'},
 {key:'instructionList',label:'指導簿クラス一覧',type:'check',target:'intake',property:'指導簿クラス一覧'},
 {key:'fees',label:'月謝台帳',type:'check',target:'intake',property:'月謝台帳'},
];
export const isEnrollmentId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const sameNotionId=(a,b)=>String(a??'').replaceAll('-','')===String(b??'').replaceAll('-','');
export function propertyText(p){
 if(!p)return '';
 if(p.type==='rollup')return (p.rollup?.array??[]).map(propertyText).filter(Boolean).join('、');
 if(p.type==='formula')return String(p.formula?.string??p.formula?.number??'');
 if(p.type==='date')return p.date?.start?.slice(0,10)??'';
 if(p.type==='select')return p.select?.name??'';
 if(p.type==='multi_select')return (p.multi_select??[]).map(x=>x.name).join('、');
 if(p.type==='number')return p.number==null?'':String(p.number);
 if(p.type==='checkbox')return p.checkbox?'済':'未実施';
 const value=p[p.type];
 if(Array.isArray(value))return value.map(x=>x.plain_text??x.text?.content??x.name??x.id??'').join('');
 if(['string','number','boolean'].includes(typeof value))return String(value);
 return '';
}
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const canonicalProperties=page=>Object.fromEntries(Object.entries(page.properties??{}).map(([k,p])=>[k,propertyText(p)]));
export const pageSnapshot=page=>digest(canonicalProperties(page));
export function blankEnrollmentFields(){return Object.fromEntries(enrollmentFields.map(f=>[f.key,{value:'',state:'unknown',reason:'未入力',source:'',candidates:[]} ]));}
export function seedEnrollmentFields(student,intake){
 const result=blankEnrollmentFields();
 for(const f of enrollmentFields){const page=f.target==='student'?student:f.target==='intake'?intake:null;const value=propertyText(page?.properties?.[f.property]);
  // Unchecked checkboxes do not prove that the work has been assessed or performed.
  if(value&&!(f.type==='check'&&value==='未実施'))result[f.key]={value,state:'confirmed',reason:'',source:'既存のNotion情報',candidates:[]};
 }
 for(const [key,prop] of [['campus','所属'],['grade','学年']]){let value=propertyText(student.properties?.[prop]);if(key==='grade')value=value.replace(/[0-9]/g,c=>'０１２３４５６７８９'[Number(c)]);if(value)result[key]={value,state:'confirmed',reason:'',source:'既存の生徒情報',candidates:[]};}
 return result;
}
export function validateEnrollmentPayload(input){
 if(!input||typeof input!=='object'||!isEnrollmentId(input.studentPageId))throw new InterviewError('生徒を選び直してください。',422);
 const text=(value,max)=>{if(typeof value!=='string'||value.length>max)throw new InterviewError('入力の形式・文字数を確認してください。',422);return value.trim();};
 const fields=blankEnrollmentFields();
 for(const def of enrollmentFields){
  const row=input.fields?.[def.key];if(!row||!['confirmed','review','unknown','not_applicable'].includes(row.state))throw new InterviewError('各項目の確認状態を選択してください。',422);
  const value=text(row.value??'',def.type==='text'?3000:100);
  if(row.state==='confirmed'){
   if(!value)throw new InterviewError(`${def.label}の値を入力するか、要確認にしてください。`,422);
   if(def.type==='date'&&!isValidReservationDate(value))throw new InterviewError(`${def.label}の日付を確認してください。`,422);
   if(def.options&&!def.options.includes(value))throw new InterviewError(`${def.label}を選択してください。`,422);
   if(def.type==='check'&&!['済','未実施'].includes(value))throw new InterviewError(`${def.label}の実施結果を確認してください。`,422);
   if(def.type==='staff'&&!isEnrollmentId(value))throw new InterviewError('手続担当者を選択してください。',422);
   if(def.key==='studentNumber'&&!/^\d{4,12}$/.test(value))throw new InterviewError('学籍番号を確認してください。',422);
  }
  fields[def.key]={value,state:row.state,reason:text(row.reason??'',1000),source:text(row.source??'',1500),candidates:Array.isArray(row.candidates)?row.candidates.slice(0,8).map(v=>text(v,200)):[]};
 }
 return {studentPageId:input.studentPageId,intakePageId:input.intakePageId?text(input.intakePageId,36):'',fields,record:text(input.record??'',16000),sourceText:text(input.sourceText??'',40000)};
}
export function pendingEnrollmentFields(payload){return enrollmentFields.filter(f=>!['confirmed','not_applicable'].includes(payload.fields[f.key]?.state)).map(f=>({key:f.key,label:f.label,...payload.fields[f.key]}));}
export const known=(payload,key)=>payload.fields[key]?.state==='confirmed'?payload.fields[key].value:undefined;
export function typedNotionValue(schema,name,value){
 const p=schema.properties?.[name];if(!p)throw new InterviewError(`Notionの「${name}」を確認してください。`,409);
 const rt=s=>Array.from({length:Math.ceil(s.length/1800)},(_,i)=>({type:'text',text:{content:s.slice(i*1800,(i+1)*1800)}}));
 switch(p.type){
  case 'title':case 'rich_text':return {[p.type]:rt(value)};
  case 'date':return {date:{start:value}};
  case 'number':if(!/^\d+$/.test(value))break;return {number:Number(value)};
  case 'checkbox':if(!['済','未実施'].includes(value))break;return {checkbox:value==='済'};
  case 'relation':if(!isEnrollmentId(value))break;return {relation:[{id:value}]};
  case 'select':{const o=p.select.options.find(o=>o.name===value);if(o)return {select:{id:o.id}};break;}
  case 'multi_select':{const values=value.split('、').map(x=>x.trim()).filter(Boolean);const options=values.map(v=>p.multi_select.options.find(o=>o.name===v));if(values.length&&options.every(Boolean))return {multi_select:options.map(o=>({id:o.id}))};break;}
 }
 throw new InterviewError(`「${name}」の値・選択肢を確認してください。自動変更は保留しました。`,409);
}
export function desiredEnrollmentProperties(payload,target,schema,actorPageId,interviewPageId){
 const properties={};const put=(name,value)=>{if(value!==undefined)properties[name]=typedNotionValue(schema,name,value);};
 if(['student','intake'].includes(target)){
  for(const f of enrollmentFields.filter(f=>f.target===target))put(f.property,known(payload,f.key));
  if(target==='intake')put('入塾手続き日',known(payload,'procedureDate'));
 }
 if(target==='interview'){
  properties['生徒情報DB']={relation:[{id:payload.studentPageId}]};
  put('面談内容','入塾手続き');put('面談日',known(payload,'interviewDate'));put('方法',known(payload,'method'));put('面談時の学年',known(payload,'grade'));put('面談目的','入会手続き');
  if(actorPageId)properties['記入者']={relation:[{id:actorPageId}]};
 }
 if(target==='mtg'){
  if(!interviewPageId)throw new InterviewError('先に面談記録のリンクを確定してください。',409);
  properties['生徒名']={relation:[{id:payload.studentPageId}]};
  // A fixed template, with no AI summary, personal observation or health note.
  properties['内容']={title:[{type:'mention',mention:{type:'page',page:{id:interviewPageId}}},{type:'text',text:{content:' 詳細はこちら'}}]};
  put('見出し','入会手続き');put('日付',known(payload,'interviewDate'));put('面談日',known(payload,'interviewDate'));put('校舎',known(payload,'campus'));put('方法',known(payload,'method'));put('面談時の学年',known(payload,'grade'));put('面談目的','入会手続き');
  if(actorPageId)properties['報告者']={relation:[{id:actorPageId}]};
 }
 return properties;
}
export function propertyComparable(p){
 if(!p)return null;
 if(p.relation)return {relation:p.relation.map(x=>x.id.replaceAll('-','')).sort()};
 if(p.title)return {title:p.title.map(x=>x.type==='mention'?{page:x.mention?.page?.id?.replaceAll('-','')}:x.text?{text:x.text.content,link:x.text.link?.url??null}:null)};
 if(p.select)return {select:p.select.id};
 if(p.status)return {status:p.status.id};
 if(p.multi_select)return {multi_select:p.multi_select.map(x=>x.id).sort()};
 if(p.date)return {date:p.date.start};
 if(p.rich_text)return {rich_text:p.rich_text.map(x=>x.text?.content??x.plain_text??'').join('')};
 if(p.number!==undefined)return {number:p.number};
 if(p.checkbox!==undefined)return {checkbox:p.checkbox};
 return null;
}
export function safePropertyPatch(page,desired,baseline){
 const patch={};
 for(const [name,value]of Object.entries(desired)){
  const current=propertyComparable(page.properties?.[name]);const expected=baseline[name]??null;const next=propertyComparable(value);
  if(JSON.stringify(current)===JSON.stringify(next))continue;
  if(JSON.stringify(current)!==JSON.stringify(expected))throw new InterviewError(`Notionの「${name}」が変更されています。最新の内容を確認してください。`,409);
  patch[name]=value;
 }
 return patch;
}
export function checkedEnrollmentAI(result,sourceText){
 const fields={};
 for(const def of enrollmentFields){const row=result?.fields?.[def.key];if(!row)continue;
  const source=typeof row.source==='string'?row.source:'';
  const value=typeof row.value==='string'?row.value.slice(0,3000):'';
  // AI suggestions always require a human decision. A source must be an exact quotation.
  fields[def.key]={value,state:'review',source:source&&sourceText.includes(source)?source:'',reason:source&&sourceText.includes(source)?'AIの候補です。原文を見て確定してください。':'根拠を特定できません。職員の判断が必要です。',candidates:[]};
 }
 return {record:typeof result?.record==='string'?result.record.slice(0,16000):'',fields};
}
