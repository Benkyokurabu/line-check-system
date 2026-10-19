import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {createClient} from '@supabase/supabase-js';
import {parentContactCloud} from '../src/lib/parent-contact-cloud.mjs';import {scheduleCloudSession} from '../src/lib/schedule-cloud.mjs';import {parentRowBlank,parentContactRow,parentRowMatches} from '../src/lib/parent-contact-core.mjs';
for(const root of [process.cwd(),path.resolve('../..')]){const file=path.join(root,'.env.local');if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}}
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),key=process.env.SUPABASE_SECRET_KEY;
const auditedFetch=async(...args)=>{const response=await fetch(...args);if(!response.ok){const body=await response.clone().json().catch(()=>({}));console.log(JSON.stringify({graphFailure:{status:response.status,code:body.error?.code,message:String(body.error?.message??'').slice(0,250)}}));}return response;};
const cloud=await parentContactCloud(db,key,auditedFetch),file=await cloud.find('2026-10'),options=await cloud.options(file),source=await cloud.read(file);
const rowIndex=source.values.findIndex((r,i)=>i>0&&parentRowBlank(r));if(rowIndex<0)throw Error('No blank row');
const specifiedWorkbook=file.id.toLowerCase().replace(/-/g,'').includes('2058fb27d78d4bbd8d44be53582c4de0');
if(!specifiedWorkbook)throw Error('Workbook identity differs from specified OneDrive document');
console.log(JSON.stringify({read:true,specifiedWorkbook,file:file.name,teachers:options.teachers,tasks:options.tasks,contents:options.contents,results:options.results,blankRow:rowIndex+4}));
if(process.argv.includes('--copy-test')){
 const session=await scheduleCloudSession(db,key),headers={Authorization:'Bearer '+session.config.token.access_token},graph='https://graph.microsoft.com/v1.0';
 const sourceUrl=`${graph}/drives/${encodeURIComponent(file.drive)}/items/${encodeURIComponent(file.id)}/content`;
 const download=async url=>{const r=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Download failed '+r.status);return Buffer.from(await r.arrayBuffer());};
 const bytes=await download(sourceUrl),hash=b=>createHash('sha256').update(b).digest('hex'),dir=path.resolve('analysis_outputs/post-interview');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'parent-worklog-before.xlsx'),bytes);
 const name='Codex検証_対保護者業務記録_'+Date.now()+'.xlsx';
 const uploaded=await fetch(`${graph}/drives/${encodeURIComponent(session.config.driveId)}/root:/${encodeURIComponent(name)}:/content`,{method:'PUT',headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:bytes,signal:AbortSignal.timeout(30000)});
 if(!uploaded.ok)throw Error('Copy upload failed '+uploaded.status);const copy=await uploaded.json(),ref={...file,drive:copy.parentReference.driveId,id:copy.id,name:copy.name,url:copy.webUrl};
 const before=await cloud.read(ref,`B${rowIndex+4}:K${rowIndex+4}`),desired=parentContactRow({fields:{date:{state:'confirmed',value:'2026-10-19'}},workLog:{enabled:true,teacher:options.teachers.at(-1),task:options.tasks[0],start:'16:05',end:'16:40',contact:'検証用の生徒・保護者（原本への記入ではありません）',content:options.contents[0],result:options.results[0]}},options);
 const written=await cloud.write(ref,rowIndex+4,desired.values,before.values[0]);if(!parentRowMatches(written,desired.values)||Math.abs(Number(written[6])-desired.duration)>1e-8)throw Error('Copy range verification failed');
 fs.writeFileSync(path.join(dir,'parent-worklog-after.xlsx'),await download(`${graph}/drives/${encodeURIComponent(ref.drive)}/items/${encodeURIComponent(ref.id)}/content`));
 if(hash(bytes)!==hash(await download(sourceUrl)))throw Error('Original changed during copy test');
 fs.writeFileSync(path.join(dir,'parent-worklog-copy-test.json'),JSON.stringify({copyName:copy.name,row:rowIndex+4,originalUnchanged:true,nativeWriteVerified:true},null,2));console.log(JSON.stringify({copyName:copy.name,row:rowIndex+4,originalUnchanged:true,nativeWriteVerified:true}));
}
