import fs from 'node:fs';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {BENSUKE_SOURCE} from '../src/lib/bensuke-booking.mjs';
import {surveyScheduleValue} from '../src/lib/survey-bensuke.mjs';
for(const file of ['.env.local','../../.env.local'])if(fs.existsSync(file)){process.loadEnvFile(file);break;}
const answer=process.argv.find(v=>v.startsWith('--answer='))?.slice(9);
if(!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(answer??''))throw Error('An explicit answer ID is required');
const marker=`勉たん面談アンケート:${answer.replaceAll('-','').toLowerCase()}`;
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const request=async(p,init={})=>{const response=await fetch('https://api.notion.com/v1'+p,{...init,headers:{Authorization:'Bearer '+(process.env.NOTION_TOKEN??process.env.NOTION_API_KEY),'Notion-Version':'2025-09-03','Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Notion operation failed: '+response.status);return response.json();};
const rpc=async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw Error('Schedule ledger operation failed');return r.data;};
const row=await db.from('survey_bensuke_links').select('*').eq('answer_id',answer).single();if(row.error||!row.data?.page_id)throw Error('Linked schedule not found');
const original=row.data,page=await request('/pages/'+original.page_id);
if(page.archived||page.in_trash||page.parent?.data_source_id.replaceAll('-','')!==BENSUKE_SOURCE.replaceAll('-',''))throw Error('Active schedule source mismatch');
const old=surveyScheduleValue(page),parts=old.note.split('\n'),index=parts.indexOf(marker);
if(index<0){console.log(JSON.stringify({alreadyClean:true,lineSent:false}));process.exit(0);}
if(parts.filter(v=>v===marker).length!==1)throw Error('Unexpected marker count');
const prefix=parts.slice(0,index).join('\n'),suffix=parts.slice(index+1).join('\n');
const next=[prefix,suffix].filter(Boolean).join('\n');
// Preserve rich-text formatting outside the removed line.
const markerStart=parts.slice(0,index).reduce((n,line)=>n+line.length+1,0);
const cutStart=index>0?markerStart-1:markerStart,cutEnd=markerStart+marker.length+(index===0&&parts.length>1?1:0);
let offset=0;
const rich=(page.properties['備考'].rich_text??[]).flatMap(item=>{const content=item.plain_text??item.text?.content??'',start=offset;offset+=content.length;const keep=content.slice(0,Math.max(0,Math.min(content.length,cutStart-start)))+content.slice(Math.max(0,Math.min(content.length,cutEnd-start)));if(!keep)return [];if(item.type!=='text'&&!item.text)throw Error('Unexpected rich-text marker shape');return [{type:'text',text:{...item.text,content:keep},...(item.annotations?{annotations:item.annotations}:{})}];});
if(rich.map(v=>v.text.content).join('')!==next)throw Error('Note preservation check failed');
const dir='analysis_outputs/survey-note-cleanup';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`before-${Date.now()}.json`),JSON.stringify({link:original,page},null,2),{flag:'wx'});
if(!process.argv.includes('--apply')){console.log(JSON.stringify({preview:true,targetCount:1,markerOnly:old.note===marker,unrelatedNotePreserved:true,backupCreated:true,lineSent:false}));process.exit(0);}
const link=await rpc('survey_bensuke_claim',{p_answer:answer});
try{
 if(link.page_id!==page.id||!['synced','saved'].includes(link.state))throw Error('Schedule is being updated');
 const fresh=await request('/pages/'+page.id);if(JSON.stringify(fresh.properties)!==JSON.stringify(page.properties)||fresh.last_edited_time!==page.last_edited_time)throw Error('Schedule changed concurrently');
 if(link.baseline?.note!==old.note||link.expected?.note!==old.note)throw Error('Ledger note changed; reconciliation required');
 // Stage both snapshots before the Notion write so a lost response remains recoverable.
 await rpc('survey_bensuke_store',{p_answer:answer,p_lease:link.lease,p_value:{expected:{...link.expected,note:next},state:'updating'},p_release:false});
 await request('/pages/'+page.id,{method:'PATCH',body:JSON.stringify({properties:{'備考':{rich_text:rich}}})});
 const after=await request('/pages/'+page.id),value=surveyScheduleValue(after);
 if(JSON.stringify({...value,note:old.note})!==JSON.stringify(old)||value.note!==next)throw Error('Schedule preservation check failed');
 await rpc('survey_bensuke_store',{p_answer:answer,p_lease:link.lease,p_value:{baseline:{...link.baseline,note:next},expected:{...link.expected,note:next},state:link.state},p_release:true});
 const verified=await db.from('survey_bensuke_links').select('baseline,expected,state').eq('answer_id',answer).single();if(verified.error||verified.data.baseline.note!==next||verified.data.expected.note!==next)throw Error('Ledger verification failed');
 fs.writeFileSync(path.join(dir,`after-${Date.now()}.json`),JSON.stringify({page:after,link:verified.data},null,2),{flag:'wx'});
 console.log(JSON.stringify({updated:true,targetCount:1,markerRemoved:true,otherScheduleValuesPreserved:true,ledgerVerified:true,lineSent:false}));
}finally{await rpc('survey_bensuke_store',{p_answer:answer,p_lease:link.lease,p_value:{},p_release:true}).catch(()=>{});}
