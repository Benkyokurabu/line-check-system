import {relationLabel} from './line-contact-registration.mjs';
const guardians=new Set(['mother','father','guardian','family','shared']);
const validId=id=>/^U[0-9a-f]{32}$/i.test(String(id??''));
/** Use saved student-number links, never a name search or a guessed family member. */
export function surveyLineRecipients(number,accounts,legacyLinks=[],aliases=[]){
 const result=new Map(),byAlias=new Map(aliases.map(x=>[x.line_user_id,x.alias_name]));
 const rows=accounts.filter(x=>String(x.student_number)===String(number));
 for(const row of rows){
  if(!validId(row.line_user_id)||!['confirmed','unverified'].includes(row.verification_status))continue;
  const relation=String(row.relation??'unknown'),category=guardians.has(relation)?'guardian':relation==='student'?'student':'unknown';
  const aliasName=byAlias.get(row.line_user_id)||row.alias_name||'',displayName=row.friend_display_name||'';
  result.set(row.line_user_id,{id:row.line_user_id,relation,category,studentNumber:String(number),aliasName,displayName,
   label:[relationLabel(relation),aliasName||displayName||'LINE名未登録'].join('・'),
   verification:row.verification_status==='confirmed'?'confirmed':'registered',source:'student_number'});
 }
 for(const link of legacyLinks){
  if(String(link.student_number)!==String(number)||!validId(link.line_user_id)||rows.some(x=>x.line_user_id===link.line_user_id))continue;
  const aliasName=byAlias.get(link.line_user_id)||'';
  result.set(link.line_user_id,{id:link.line_user_id,relation:'unknown',category:'unknown',studentNumber:String(number),aliasName,displayName:'',
   label:`続柄未確認・${aliasName||'LINE名未登録'}`,verification:'registered',source:'legacy_student_number'});
 }
 return [...result.values()].sort((a,b)=>({guardian:0,student:1,unknown:2}[a.category]-{guardian:0,student:1,unknown:2}[b.category])||a.label.localeCompare(b.label,'ja'));
}
