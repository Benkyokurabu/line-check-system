import {scheduleCloudSession} from './schedule-cloud.mjs';
import {InterviewError} from './interview-core.mjs';
import {parentContactMonth} from './parent-contact-core.mjs';
const GRAPH='https://graph.microsoft.com/v1.0',SELECT='id,name,folder,file,webUrl,parentReference,remoteItem';
const normalized=value=>String(value??'').normalize('NFKC').replace(/[\s　]/g,'');
export async function parentContactCloud(db,key,fetcher=fetch){
 const session=await scheduleCloudSession(db,key,fetcher),allowed=new Set([session.config.driveId]);
 const base=drive=>`${GRAPH}/drives/${encodeURIComponent(drive)}`;
 async function call(url,init={}){
  if(![...allowed].some(d=>url.startsWith(base(d)+'/')))throw new InterviewError('業務記録簿の接続先を確認できません。',409);
  const response=await fetcher(url,{...init,headers:{Authorization:`Bearer ${session.config.token.access_token}`,'Content-Type':'application/json',...init.headers},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new InterviewError(response.status===409||response.status===423?'業務記録簿を他の操作が使用中です。時間をおいて反映を再試行します。':'OneDriveの業務記録簿との通信を完了できませんでした。入力は勉たんに保存されています。',503);
  return response.status===204?{}:response.json();
 }
 function folder(item,drive){const target=item.remoteItem??item,owner=target.parentReference?.driveId??drive;if(!target.id||!target.folder)throw new InterviewError('業務記録簿のフォルダを確認できません。',409);allowed.add(owner);return {id:target.id,drive:owner};}
 async function children(ref){const prefix=`${base(ref.drive)}/items/${encodeURIComponent(ref.id)}/children`;let url=prefix+`?$select=${SELECT}&$top=200`;const rows=[];for(let i=0;url&&i<20;i++){if(!url.startsWith(prefix+'?'))throw new InterviewError('業務記録簿の参照先が不正です。',409);const data=await call(url);rows.push(...data.value);url=data['@odata.nextLink'];}if(url)throw new InterviewError('業務記録簿の一覧を全件確認できません。',409);return rows;}
 async function find(month){
  parentContactMonth(month);const [year,monthText]=month.split('-'),number=Number(monthText);
  const shared=folder(await call(`${base(session.config.driveId)}/root:/${encodeURIComponent('●勉強クラブ共有')}?$select=${SELECT}`),session.config.driveId);
  const root=await children(shared);let groups=[{ref:shared,items:root}];const targetName=`004担任業務記録簿${year}年${number}月対保護者.xlsx`;
  if(!root.some(f=>normalized(f.name)===targetName)){
   for(const item of root.filter(x=>['02過去の勤務記録簿','03次月の勤務記録簿'].includes(normalized(x.name)))){
    const ref=folder(item,shared.drive),items=await children(ref);groups.push({ref,items});
    for(const nested of items.filter(x=>normalized(x.name)===`${year}年${number}月勤務記録簿`)){const child=folder(nested,ref.drive);groups.push({ref:child,items:await children(child)});}
   }
  }
  const matches=groups.flatMap(g=>g.items.filter(x=>normalized(x.name)===targetName).map(item=>{const target=item.remoteItem??item,drive=target.parentReference?.driveId??g.ref.drive;allowed.add(drive);return {drive,id:target.id,name:item.name,url:target.webUrl??item.webUrl,month};}));
  if(matches.length!==1)throw new InterviewError(`${year}年${number}月の対保護者業務記録簿を一意に確認できません。原本は変更していません。`,409);return matches[0];
 }
 const workbook=ref=>`${base(ref.drive)}/items/${encodeURIComponent(ref.id)}/workbook`;
 function range(ref,sheet,address){if(!['入力','リスト'].includes(sheet)||! /^(B\d+:[EFK]\d+|G\d+:G\d+|I\d+:K\d+)$/.test(address))throw new InterviewError('業務記録簿の書込範囲を確認してください。',409);return `${workbook(ref)}/worksheets/${encodeURIComponent(sheet)}/range(address='${address}')`;}
 async function read(ref,address='B4:K204',sheet='入力'){return call(range(ref,sheet,address));}
 async function options(ref){const data=await read(ref,'B1:F100','リスト'),rows=data.values??[];if(normalized(rows[0]?.[1])!=='先生'||normalized(rows[0]?.[2])!=='摘要')throw new InterviewError('業務記録簿の選択肢シートが変更されています。',409);const list=i=>[...new Set(rows.slice(1).map(r=>String(r[i]??'').trim()).filter(Boolean))];return {teachers:list(1),tasks:list(2),results:list(3),contents:list(4)};}
 async function write(ref,row,values,before){
  if(!Number.isInteger(row)||row<5||row>204)throw new InterviewError('業務記録簿の記入行を確認してください。',409);
  let sessionId='';try{
   sessionId=(await call(workbook(ref)+'/createSession',{method:'POST',body:JSON.stringify({persistChanges:true})})).id;if(!sessionId)throw new InterviewError('Excelへの保存を開始できませんでした。',503);
   const headers={'workbook-session-id':sessionId};const current=await call(range(ref,'入力',`B${row}:K${row}`),{headers});
   if(JSON.stringify(current.values?.[0])!==JSON.stringify(before))throw new InterviewError('業務記録の記入行が他の操作で変更されました。上書きは保留しました。',409);
   // Excel rejects ranges containing protected cells even when their values are null.
   // Preserve F's separator, H's shared formula, styles and sheet protection.
   for(const [address,cells]of [[`B${row}:E${row}`,values.slice(0,4)],[`G${row}:G${row}`,[values[5]]],[`I${row}:K${row}`,values.slice(7)]]){
    await call(range(ref,'入力',address),{method:'PATCH',headers,body:JSON.stringify({values:[cells]})});
   }
   const checked=await call(range(ref,'入力',`B${row}:K${row}`),{headers});return checked.values[0];
  }finally{if(sessionId)await call(workbook(ref)+'/closeSession',{method:'POST',headers:{'workbook-session-id':sessionId}});}
 }
 return {find,read,options,write};
}
export async function parentContactOptions(db,key,month,fetcher=fetch){const cloud=await parentContactCloud(db,key,fetcher),file=await cloud.find(month);return {month,file:{name:file.name,url:file.url},...await cloud.options(file)};}
