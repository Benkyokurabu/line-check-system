import {InterviewError} from './interview-core.mjs';import {digest} from './enrollment-core.mjs';
import {normalizeParentWorkLog,parentContactRow,parentRowMatches,parentRowBlank,parentRowCompatible} from './parent-contact-core.mjs';
import {parentContactCloud} from './parent-contact-cloud.mjs';
const checked=result=>{if(result.error)throw new InterviewError('業務記録の反映状態を保存できませんでした。入力は保持しています。',503);return result.data;};
export async function syncParentContactLog({db,entry,checkpoint,key,fetcher=fetch,makeCloud=parentContactCloud}){
 if(!normalizeParentWorkLog(entry.payload.workLog).enabled)return;
 const state=entry.targets.workLog??={status:'pending'};if(state.status==='synced'||state.status==='skipped')return;
 let lease=null;const save=async()=>{if(!await checkpoint(entry.targets,'running'))throw new InterviewError('保存内容の版が変わりました。業務記録の反映を保留しました。',409);};
 try{
  // Missing human input is reviewable before contacting Excel.
  const form=normalizeParentWorkLog(entry.payload.workLog);parentContactRow(entry.payload,{teachers:[form.teacher],tasks:[form.task],contents:[form.content],results:[form.result]});
  lease=checked(await db.rpc('claim_parent_contact_workbook',{}));if(!lease)throw new InterviewError('別の業務記録を反映中です。少し待って再試行します。',503);
  const cloud=await makeCloud(db,key,fetcher),file=await cloud.find(entry.payload.fields.date.value.slice(0,7));const options=await cloud.options(file),desired=parentContactRow(entry.payload,options);
  const fingerprint=digest({month:desired.month,values:desired.values});let reservation=checked(await db.from('parent_contact_log_rows').select('*').eq('entry_id',entry.id).maybeSingle());
  const range=await cloud.read(file),rows=range.values??[];const expectedHeaders=['日付','氏名','摘要','開始','','終了','時間','生徒名+父か母','内容','結果'];
  if(expectedHeaders.some((h,i)=>h&&String(rows[0]?.[i]??'').normalize('NFKC').replace(/\s/g,'')!==h))throw new InterviewError('業務記録簿の入力列が変更されています。書込みを保留しました。',409);
  if(reservation&&(reservation.drive_id!==file.drive||reservation.item_id!==file.id))throw new InterviewError('前回と業務記録簿の月・原本が異なります。既存の記入先を確認してください。',409);
  if(!reservation){
   const reserved=checked(await db.from('parent_contact_log_rows').select('row_number').eq('drive_id',file.drive).eq('item_id',file.id).limit(200));const used=new Set(reserved.map(r=>r.row_number));
   const index=rows.findIndex((r,i)=>i>0&&i<=200&&!used.has(i+4)&&parentRowBlank(r));if(index<0)throw new InterviewError('業務記録簿の空き行がありません。原本の行数を確認してください。',409);
   reservation=checked(await db.from('parent_contact_log_rows').insert({entry_id:entry.id,drive_id:file.drive,item_id:file.id,row_number:index+4,expected:desired.values,fingerprint,last_written:null}).select('*').single());
  }
  const row=reservation.row_number,current=rows[row-4];if(!current)throw new InterviewError('業務記録簿の予約した行を確認できません。',409);
  state.row=row;state.file=file.name;state.url=file.url;state.status='writing';state.error='';await save();
  const same=parentRowMatches(current,desired.values);
  if(!same&&!parentRowBlank(current)&&!parentRowMatches(current,reservation.last_written??reservation.expected)&&!(reservation.last_written===null&&parentRowCompatible(current,reservation.expected)))throw new InterviewError('業務記録の行は別の内容で記入済みです。上書きせず確認を保留しました。',409);
  checked(await db.from('parent_contact_log_rows').update({expected:desired.values,fingerprint,updated_at:new Date().toISOString()}).eq('entry_id',entry.id));
  const durationOkay=Math.abs(Number(current[6])-desired.duration)<1e-8;
  const written=same&&durationOkay?current:await cloud.write(file,row,desired.values,current);
  if(!parentRowMatches(written,desired.values)||Math.abs(Number(written[6])-desired.duration)>1e-8)throw new InterviewError('業務記録の保存結果を確認できません。記入行を維持して再確認します。',503);
  checked(await db.from('parent_contact_log_rows').update({last_written:written,updated_at:new Date().toISOString()}).eq('entry_id',entry.id));state.status='synced';state.error='';await save();
 }catch(error){state.status=error instanceof InterviewError&&error.status<500?'review':'retry';state.error=error instanceof InterviewError?error.message:'OneDriveへの反映結果を再確認しています。入力は保持しています。';await save();}
 finally{if(lease)checked(await db.rpc('release_parent_contact_workbook',{p_lease:lease}));}
}
