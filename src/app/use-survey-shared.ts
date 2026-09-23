'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {surveyPageId} from '@/lib/survey-confirmations.mjs';
type State={confirmed:boolean;version:number;updated_at?:string;updated_name?:string};
type States=Record<string,State>;
const KEY='bentan:2026-autumn-survey-drafts-v1', LEGACY='bentan:2026-autumn-survey-confirmed';
function parse(rows:unknown):States {
 if(!Array.isArray(rows))throw Error('共有状態の応答を確認できません。');
 const next:States={};
 for(const s of rows){if(!s||!/^[a-f0-9]{32}$/.test(s.page_id)||typeof s.confirmed!=='boolean'||!Number.isSafeInteger(s.version)||s.version<1)throw Error('共有状態の応答を確認できません。');next[s.page_id]=s;}
 return next;
}
export function useSurveyConfirmations(){
 const [states,setStates]=useState<States>({}),[local,setLocal]=useState<States>({});
 const shared=useRef<States>({}),pending=useRef<States>({}),busy=useRef(false),reading=useRef(false),epoch=useRef(0);
 const [ready,setReady]=useState(false),[saving,setSaving]=useState(''),[message,setMessage]=useState(''),[loginNeeded,setLoginNeeded]=useState(false),[lastSync,setLastSync]=useState('');
 const [issues,setIssues]=useState<Record<string,string>>({});
 const store=useCallback((next:States)=>{pending.current=next;setLocal(next);try{localStorage.setItem(KEY,JSON.stringify(next));localStorage.removeItem(LEGACY);}catch{}},[]);
 const accept=useCallback((next:States)=>{shared.current=next;setStates(next);setReady(true);setLoginNeeded(false);setLastSync(new Date().toLocaleTimeString('ja-JP'));},[]);
 const load=useCallback(async()=>{
  if(busy.current||reading.current)return;
  reading.current=true;
  const generation=++epoch.current;
  try{
   const r=await fetch('/api/interview-surveys/confirmations',{cache:'no-store',signal:AbortSignal.timeout(60000)});
   if(generation!==epoch.current)return;
   if(r.status===401){setLoginNeeded(true);setReady(false);throw Error('確認状態の共有には職員ログインが必要です。');}
   if(!r.ok)throw Error('同期できません。前回の表示を保持しています。');
   const body=await r.json();if(generation!==epoch.current)return;
   accept(parse(body.states));setMessage('');
  }catch(e){if(generation===epoch.current)setMessage(e instanceof Error?e.message:'同期できません。');}
  finally{reading.current=false;}
 },[accept]);
 useEffect(()=>{
  const initial=setTimeout(()=>{
   const saved:States={};
   try{for(const [id,s] of Object.entries(JSON.parse(localStorage.getItem(KEY)||'{}')) as [string,State][]){if(/^[a-f0-9]{32}$/.test(id)&&s&&typeof s.confirmed==='boolean'&&Number.isSafeInteger(s.version)&&s.version>=0)saved[id]=s;}}catch{}
   try{const old=JSON.parse(localStorage.getItem(LEGACY)||'[]');if(Array.isArray(old))for(const url of old){const id=surveyPageId(url);if(id&&!saved[id])saved[id]={confirmed:true,version:0};}}catch{}
   store(saved);void load();
  },0);
  const refresh=()=>{if(document.visibilityState==='visible')void load();};
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
  const timer=setInterval(refresh,30000);
  const generationRef=epoch;
  return()=>{clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);generationRef.current++;};
 },[load,store]);
 const discard=(id:string)=>{const next={...pending.current};delete next[id];store(next);setIssues(v=>{const n={...v};delete n[id];return n;});};
 const save=async(id:string,confirmed:boolean,version:number)=>{
  if(!ready||busy.current)return;
  busy.current=true;epoch.current++;setSaving(id);setMessage('');store({...pending.current,[id]:{confirmed,version}});
  try{
   const r=await fetch('/api/interview-surveys/confirmations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientVersion:2,changes:[{pageId:id,confirmed,version}]}),signal:AbortSignal.timeout(60000)});
   const body=await r.json();if(r.status===401){setLoginNeeded(true);setReady(false);}
   if(r.status===409&&body.states)accept(parse(body.states));
   if(!r.ok)throw Error(r.status===409?'他のPCで変更されています。共有状態と今回の操作を確認してください。':body.error||'保存できませんでした。再試行してください。');
   const next=parse(body.states);if(!next[id])throw Error('保存結果を確認できません。再試行してください。');
   accept(next);discard(id);
  }catch(e){setIssues(v=>({...v,[id]:e instanceof Error?e.message:'保存結果を確認できません。再試行してください。'}));}
  finally{busy.current=false;setSaving('');}
 };
 const get=(url:string)=>{const id=surveyPageId(url);return id?states[id]:undefined;};
 return {ready,saving,message,loginNeeded,lastSync,local,issues,load,get,isConfirmed:(url:string)=>!!get(url)?.confirmed,
  toggle:(url:string)=>{const id=surveyPageId(url);if(id){const current=shared.current[id];void save(id,!current?.confirmed,current?.version??0);}},
  retry:(id:string)=>{const s=pending.current[id];if(s)void save(id,s.confirmed,shared.current[id]?.version??0);},discard};
}
