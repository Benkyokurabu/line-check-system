import {createHash} from 'node:crypto';
import {StaffAuthError} from './staff-auth-core.mjs';

export const contextDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function assertSchoolContext(staff){
  if(!staff?.staffId||staff.staffCode!=='KUDO'||!['admin','office','employee'].includes(staff.role))throw new StaffAuthError('permission_denied',403);
}
export function contextText(value){
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(contextText).filter(Boolean).join('');
  if(!value||typeof value!=='object')return '';
  if(typeof value.plain_text==='string')return value.plain_text;
  if(value.type==='text')return value.text?.content??'';
  if(value.type==='title'||value.type==='rich_text')return (value[value.type]??[]).map(contextText).join('');
  if(value.type==='select'||value.type==='status')return value[value.type]?.name??'';
  if(value.type==='multi_select')return (value.multi_select??[]).map(item=>item.name).join('、');
  if(value.type==='date')return [value.date?.start,value.date?.end].filter(Boolean).join('〜');
  if(['number','checkbox','url','email','phone_number'].includes(value.type))return String(value[value.type]??'');
  if(value.type==='formula'&&value.formula)return String(value.formula[value.formula.type]??'');
  return '';
}
export function notionAssociations(page){
  const associations=[];
  // Relation IDs are evidence, never guessed student identities from names.
  for(const [property,value] of Object.entries(page.properties??{}))if(value.type==='relation')for(const item of value.relation??[])associations.push({kind:'notion_relation',id:item.id,reason:{property,sourcePageId:page.id},verifiedStudent:false});
  return associations;
}
export function notionRecord(page,blocks,{complete=true,limitations=[],fetchedAt=new Date().toISOString()}={}){
  const title=Object.values(page.properties??{}).filter(p=>p.type==='title').map(contextText).join('')||'(無題)';
  const properties=Object.entries(page.properties??{}).map(([key,p])=>`${key}: ${contextText(p)}`).filter(v=>!v.endsWith(': '));
  const text=[title,...properties,...blocks.map(block=>contextText(block[block.type]?.rich_text??block[block.type]?.caption??[])||block[block.type]?.title||'')].filter(Boolean).join('\n');
  const raw={page,blocks};
  return {sourceKey:`notion:${page.id}`,sourceType:'notion',nativeId:page.id,version:contextDigest({raw,complete}),title,text,sourceRef:page.url??`https://www.notion.so/${page.id.replaceAll('-','')}`,occurredAt:page.last_edited_time??null,fetchedAt,direction:null,associations:notionAssociations(page),raw,coverage:{complete,scope:'page_properties_and_blocks',limitations}};
}
export function lineRecord(row,links=[],fetchedAt=new Date().toISOString()){
  const confirmed=links.filter(link=>link.line_user_id===row.line_user_id&&link.verification_status==='confirmed');
  const raw={message:row};
  return {sourceKey:`line_messages:${row.id}`,sourceType:'line',nativeId:row.id,version:contextDigest({raw,confirmed}),title:row.direction==='outbound'?'LINE 送信記録':'LINE 受信記録',text:row.text??'',sourceRef:'/dashboard',occurredAt:row.received_at??row.created_at,fetchedAt,direction:row.direction,associations:confirmed.map(link=>({kind:'student_number',id:link.student_number,reason:{table:'student_line_accounts',verificationStatus:'confirmed',lineUserId:row.line_user_id},verifiedStudent:true})),raw,coverage:{complete:false,scope:'stored_line_message',limitations:['LINE管理画面からの直接返信や未取込経路の網羅性は未確認','画像・音声等の本文は自動解釈していません']}};
}
export function importedLineRecord(event,fetchedAt=new Date().toISOString()){
  if(!event||typeof event.sourceKey!=='string'||!event.sourceKey.trim()||event.sourceKey.length>500||typeof event.content!=='string'||!['inbound','outbound','unknown'].includes(event.direction))throw new Error('invalid_line_context_event');
  const sourceKey=event.sourceKey.startsWith('line_manager:')?event.sourceKey:`line_import:${event.sourceKey}`;
  return {sourceKey,sourceType:'line',nativeId:String(event.nativeId??event.sourceKey),version:contextDigest(event),title:'LINE 管理画面等の取込記録',text:event.content,sourceRef:typeof event.sourceRef==='string'?event.sourceRef:'',occurredAt:event.occurredAt??null,fetchedAt,direction:event.direction,associations:[],raw:event,coverage:{...event.coverage,complete:false,scope:event.coverage?.scope??'imported_message',limitations:[...(event.coverage?.limitations??[]),'取込ファイルの範囲外・相手先の生徒対応は未確認']}};
}
export function proposalForRecord(record,now=Date.now()){
  // Historical writings remain searchable; do not flood today's review with old events.
  const occurred=Date.parse(record.occurredAt??'');
  if(!Number.isFinite(occurred)||occurred>now+300000||occurred<now-30*86400000)return null;
  if(record.raw?.page?.archived||record.raw?.page?.in_trash)return null;
  if(record.direction==='outbound'||record.direction==='unknown'||!record.coverage?.complete&&record.sourceType==='notion')return null;
  if(!/(要確認|要対応|未対応|確認してください|確認をお願い|相談|面談|至急|心配)/u.test(record.text))return null;
  return {fingerprint:contextDigest({rule:'explicit-review-v1',sourceKey:record.sourceKey}),rule:'explicit-review-v1',title:'記録にある確認・相談事項を見直す',description:'原文に確認・相談等の表現があります。対応の要否を原文と最新のやりとりで確認してください。未対応・未返信とは判定していません。',evidence:[{sourceKey:record.sourceKey,version:record.version,sourceRef:record.sourceRef,excerpt:record.text.slice(0,500)}],coverage:record.coverage};
}
