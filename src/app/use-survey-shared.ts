'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {surveyPageId} from '@/lib/survey-confirmations.mjs';
export type SurveyProgress='needs-review'|'handled'|'coordinating'|'scheduled'|'completed';
type State={confirmed:boolean;progress_status?:SurveyProgress|null;version:number;updated_at?:string;updated_name?:string};
type States=Record<string,State>;
const KEY='bentan:2026-autumn-survey-drafts-v1', LEGACY='bentan:2026-autumn-survey-confirmed';
const ATTEMPTED='bentan:2026-autumn-survey-shared-migration-attempted-v2';
function parse(rows:unknown):States {
 if(!Array.isArray(rows))throw Error('共有状態の応答を確認できません。');
 const next:States={};
 for(const s of rows){if(!s||!/^[a-f0-9]{32}$/.test(s.page_id)||typeof s.confirmed!=='boolean'||(s.progress_status!=null&&!['needs-review','handled','coordinating','scheduled','completed'].includes(s.progress_status))||!Number.isSafeInteger(s.version)||s.version<1)throw Error('共有状態の応答を確認できません。');next[s.page_id]=s;}
 return next;
}
export function useSurveyConfirmations(answerUrls:string[]){
 const [states,setStates]=useState<States>({}),[local,setLocal]=useState<States>({});
 const [restored,setRestored]=useState<States>({});
 const [optimistic,setOptimistic]=useState<States>({});
 const shared=useRef<States>({}),pending=useRef<States>({}),busy=useRef(new Set<string>()),reading=useRef(false),epoch=useRef(0);
 const migrationAttempted=useRef(new Set<string>());
 const [ready,setReady]=useState(false),[savingIds,setSavingIds]=useState<string[]>([]),[message,setMessage]=useState(''),[loginNeeded,setLoginNeeded]=useState(false),[lastSync,setLastSync]=useState('');
 const [issues,setIssues]=useState<Record<string,string>>({});
 const store=useCallback((next:States)=>{pending.current=next;setLocal(next);try{localStorage.setItem(KEY,JSON.stringify(next));}catch{}},[]);
 const accept=useCallback((next:States,merge=false)=>{const accepted=merge?{...shared.current,...next}:next;shared.current=accepted;setStates(accepted);setReady(true);setLoginNeeded(false);setLastSync(new Date().toLocaleTimeString('ja-JP'));},[]);
 const load=useCallback(async()=>{
  if(busy.current.size||reading.current)return;
  reading.current=true;
  const generation=++epoch.current;
  try{
   const r=await fetch('/api/interview-surveys/confirmations',{cache:'no-store',signal:AbortSignal.timeout(60000)});
   if(generation!==epoch.current)return;
   if(r.status===401){setLoginNeeded(true);setReady(false);throw Error('対応状況の共有には職員ログインが必要です。');}
   if(!r.ok)throw Error('同期できません。前回の表示を保持しています。');
   const body=await r.json();if(generation!==epoch.current)return;
   accept(parse(body.states));setMessage('');
  }catch(e){if(generation===epoch.current)setMessage(e instanceof Error?e.message:'同期できません。');}
  finally{reading.current=false;}
 },[accept]);
 useEffect(()=>{
  const initial=setTimeout(()=>{
   const saved:States={};
   try{if(!localStorage.getItem('bentan:2026-autumn-survey-before-sharing'))localStorage.setItem('bentan:2026-autumn-survey-before-sharing',JSON.stringify({drafts:localStorage.getItem(KEY),legacy:localStorage.getItem(LEGACY)}));}catch{}
   try{const ids=JSON.parse(localStorage.getItem(ATTEMPTED)||'[]');if(Array.isArray(ids))for(const id of ids)if(typeof id==='string')migrationAttempted.current.add(id);}catch{}
   try{for(const [id,s] of Object.entries(JSON.parse(localStorage.getItem(KEY)||'{}')) as [string,State][]){if(/^[a-f0-9]{32}$/.test(id)&&s&&typeof s.confirmed==='boolean'&&Number.isSafeInteger(s.version)&&s.version>=0)saved[id]=s;}}catch{}
   try{const old=JSON.parse(localStorage.getItem(LEGACY)||'[]');if(Array.isArray(old))for(const url of old){const id=surveyPageId(url);if(id&&!saved[id])saved[id]={confirmed:true,version:0};}}catch{}
   setRestored(saved);store(saved);void load();
  },0);
  const refresh=()=>{if(document.visibilityState==='visible')void load();};
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  const generationRef=epoch;
  return()=>{clearTimeout(initial);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);generationRef.current++;};
 },[load,store]);
 const discard=useCallback((id:string)=>{const next={...pending.current};delete next[id];store(next);setRestored(v=>{const n={...v};delete n[id];return n;});try{const old=JSON.parse(localStorage.getItem(LEGACY)||'[]');if(Array.isArray(old))localStorage.setItem(LEGACY,JSON.stringify(old.filter(url=>surveyPageId(url)!==id)));}catch{}setIssues(v=>{const n={...v};delete n[id];return n;});},[store]);
 const save=useCallback(async(id:string,progress:SurveyProgress,version:number)=>{
  if(!ready||busy.current.has(id))return;
  const confirmed=progress!=='needs-review';
  migrationAttempted.current.add(id);try{localStorage.setItem(ATTEMPTED,JSON.stringify([...migrationAttempted.current]));}catch{}
  const optimisticState={confirmed,progress_status:progress,version};
  busy.current.add(id);epoch.current++;setSavingIds(ids=>[...ids,id]);setOptimistic(current=>({...current,[id]:optimisticState}));setMessage('');store({...pending.current,[id]:optimisticState});
  try{
   const r=await fetch('/api/interview-surveys/confirmations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientVersion:3,changes:[{pageId:id,progress,version}]}),signal:AbortSignal.timeout(60000)});
   const body=await r.json();if(r.status===401)setLoginNeeded(true);
   if(r.status===409&&body.states)accept(parse(body.states),true);
   if(!r.ok)throw Error(r.status===409?'他のPCで変更されています。共有状態と今回の操作を確認してください。':body.error||'保存できませんでした。再試行してください。');
   const next=parse(body.states);if(!next[id])throw Error('保存結果を確認できません。再試行してください。');
   accept(next,true);discard(id);
  }catch(e){setIssues(v=>({...v,[id]:e instanceof Error?e.message:'保存結果を確認できません。再試行してください。'}));}
  finally{busy.current.delete(id);setSavingIds(ids=>ids.filter(savedId=>savedId!==id));setOptimistic(current=>{const next={...current};delete next[id];return next;});}
 },[ready,store,accept,discard]);
 useEffect(()=>{
  if(!ready||savingIds.length)return;
  const acknowledged=Object.entries(local).find(([id,s])=>(states[id]?.progress_status??(states[id]?.confirmed?'handled':'needs-review'))===(s.progress_status??(s.confirmed?'handled':'needs-review'))&&states[id].version>=s.version);
  if(acknowledged){const timer=setTimeout(()=>discard(acknowledged[0]),0);return()=>clearTimeout(timer);}
  const allowed=new Set(answerUrls.map(url=>surveyPageId(url)));
  const candidate=Object.entries(local).find(([id,s])=>allowed.has(id)&&s.version===0&&!states[id]&&!migrationAttempted.current.has(id));
  if(!candidate)return;
  const [id,s]=candidate;
  // A single attempt; failures and concurrent shared edits require explicit review.
  const timer=setTimeout(()=>void save(id,s.progress_status??(s.confirmed?'handled':'needs-review'),0),0);
  return()=>{clearTimeout(timer);};
 },[ready,savingIds,local,states,answerUrls,save,discard]);
 const get=(url:string)=>{const id=surveyPageId(url);return id?(optimistic[id]??states[id]??restored[id]):undefined;};
 return {ready,saving:savingIds[0]??'',savingCount:savingIds.length,message,loginNeeded,lastSync,local,issues,load,get,getShared:(url:string)=>{const id=surveyPageId(url);return id?states[id]:undefined;},isLocal:(url:string)=>{const id=surveyPageId(url);return !!(id&&!states[id]&&restored[id]);},isConfirmed:(url:string)=>!!get(url)?.confirmed,
  isSaving:(url:string)=>{const id=surveyPageId(url);return !!id&&busy.current.has(id);},isSavingId:(id:string)=>busy.current.has(id),
  progress:(url:string)=>get(url)?.progress_status??undefined,
  setProgress:(url:string,progress:SurveyProgress)=>{const id=surveyPageId(url);if(id){const current=shared.current[id]??restored[id];void save(id,progress,current?.version??0);}},
  toggle:(url:string)=>{const id=surveyPageId(url);if(id){const current=shared.current[id]??restored[id];void save(id,current?.confirmed?'needs-review':'handled',current?.version??0);}},
  retry:(id:string)=>{const s=pending.current[id];if(s)void save(id,s.progress_status??(s.confirmed?'handled':'needs-review'),shared.current[id]?.version??0);},discard};
}
