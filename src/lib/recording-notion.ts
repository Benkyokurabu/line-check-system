import 'server-only';
import {recordingProgressSources,recordingRangeSource,progressRow,matchesRecordingProgress,sharedProgressState,testRange} from '@/lib/recording-notion-core.mjs';
import type {Publication} from '@/lib/recording-publication-store';
export type ProgressRow={id:string;month:string;test:string;testName:string;lesson:string;class:string;campus:string;subject:string;noAbsences:boolean;makeupComplete:boolean};
export type TestRange={id:string;date:string;group:string;campus:string;title:string;test:string};
const reads=new Map<string,{expires:number;value:Promise<{results:unknown[];has_more:boolean;next_cursor:string|null}>}>();
async function request(path:string, body:unknown) {
 const key=path+JSON.stringify(body),cached=reads.get(key);
 if(cached && cached.expires>Date.now())return cached.value;
 const value=fetchNotion(path,body).catch(error=>{reads.delete(key);throw error;});
 reads.set(key,{expires:Date.now()+10000,value});
 return value;
}
async function fetchNotion(path:string,body:unknown) {
 const token=process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
 if(!token)throw new Error('Notion連携が設定されていません。');
 const response=await fetch('https://api.notion.com/v1'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Notion-Version':process.env.NOTION_VERSION ?? '2025-09-03','Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Notionの受験完了チェックを取得できません。');
 const data=await response.json();
 if(!Array.isArray(data.results)||typeof data.has_more!=='boolean'||(data.has_more&&!data.next_cursor))throw new Error('Notionの一覧を最後まで確認できません。');
 return data as {results:unknown[];has_more:boolean;next_cursor:string|null};
}
export async function readProgressRows(month:string):Promise<ProgressRow[]> {
 const source=recordingProgressSources.find(s=>s.month===month);
 if(!source)return [];
 const rows:ProgressRow[]=[];let cursor:string|undefined;
 do {
  const data=await request(`/data_sources/${source.id}/query`,{page_size:100,...(cursor?{start_cursor:cursor}:{})});
  for(const page of data.results){const row=progressRow(page,source);if(row)rows.push(row);}
  cursor=data.has_more?data.next_cursor!:undefined;
 }while(cursor);
 return rows;
}
export async function readTestRanges():Promise<TestRange[]> {
 const rows:TestRange[]=[];let cursor:string|undefined;
 do{
  const data=await request(`/data_sources/${recordingRangeSource}/query`,{page_size:100,filter:{property:'実施日',date:{on_or_after:'2026-10-01'}},...(cursor?{start_cursor:cursor}:{})});
  for(const page of data.results){const row=testRange(page);if(row)rows.push(row);}
  cursor=data.has_more?data.next_cursor!:undefined;
 }while(cursor);
 return rows;
}
export async function readTestSnapshot(){
 const ranges=await readTestRanges();
 // Failed sources must not silently remove a campus from the release gate.
 const progress=(await Promise.all(recordingProgressSources.map(s=>readProgressRows(s.month))).catch(()=>[])).flat();
 return {ranges,progress};
}
export async function readLinkedProgress(key:string,pageId:string):Promise<ProgressRow> {
 if(!/^[0-9a-f-]{36}$/i.test(pageId))throw new Error('Notionの対象行を選択してください。');
 const rows=await readProgressRows(key.slice(0,7));
 const row=rows.find(p=>p.id===pageId);
 if(!row || !matchesRecordingProgress(key,row))throw new Error('Notionの校舎・クラス・科目・テスト回が対象録画と一致しません。');
 return row;
}
export async function resolveNotionRules(rules:Publication[]) {
 const result=rules.map(rule=>({...rule}));
 if(!result.some(rule=>rule.mode==='notion'))return result;
 try{
  const {ranges,progress}=await readTestSnapshot();
  for(const rule of result){
   if(rule.mode!=='notion')continue;
   const fields=rule.event_key.split('|');
   const range=ranges.find(r=>r.date===fields[0]&&r.campus===fields[2]&&r.group===fields[3]);
   const options=progress.filter(p=>matchesRecordingProgress(rule.event_key,p)&&p.testName===range?.test);
   const row=rule.automatic?(options.length===1?options[0]:null):progress.find(p=>p.id===rule.notion_page_id);
   const state=sharedProgressState(rule.event_key,row,progress,ranges);
   rule.notion_ready=state.ready;rule.notion_checks=state.checks;rule.notion_error=state.error;
  }
 }catch{
  for(const rule of result)if(rule.mode==='notion'){rule.notion_ready=false;rule.notion_checks=[];rule.notion_error='Notionの両教室のチェックを確認できないため非公開を維持しています。';}
 }
 return result;
}
export async function automaticTestRules(){
 const {ranges,progress}=await readTestSnapshot();
 return ranges.map(range=>{
  const key=`${range.date}|test|${range.campus}|${range.group}|1`;
  const options=progress.filter(p=>matchesRecordingProgress(key,p)&&p.testName===range.test);
  const row=options.length===1?options[0]:null;
  const state=sharedProgressState(key,row,progress,ranges);
  return {key:'test:'+range.id,eventKeys:[],mode:'notion',status:state.ready?'public':'hidden',url:'',urlHashes:[],version:0,releaseAt:null,match:{date:range.date,group:range.group,campus:range.campus},notionPageId:row?.id ?? null,test:range.test};
 });
}
