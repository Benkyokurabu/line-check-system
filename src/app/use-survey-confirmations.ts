'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {surveyPageId} from '@/lib/survey-confirmations.mjs';
type State={confirmed:boolean;version:number};
type States=Record<string,State>;
const KEY='bentan:2026-autumn-survey-drafts-v1';
const LEGACY='bentan:2026-autumn-survey-confirmed';
export function useSurveyConfirmations(){
 const [states,setStates]=useState<States>({}),[drafts,setDrafts]=useState<States>({});
 const draftRef=useRef<States>({}),initialized=useRef(false),inFlight=useRef(false),savingRef=useRef(false);
 const generation=useRef(0);
 const [ready,setReady]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[loginNeeded,setLoginNeeded]=useState(false);
 const store=useCallback((next:States)=>{draftRef.current=next;setDrafts(next);try{localStorage.setItem(KEY,JSON.stringify(next));}catch{/* Drafts remain in memory. */}},[]);
 const load=useCallback(async()=>{
  if(inFlight.current||savingRef.current)return;
  inFlight.current=true;
  const epoch=generation.current;
  try{
   const r=await fetch('/api/interview-surveys/confirmations',{cache:'no-store'}),body=await r.json();
   if(!r.ok||!Array.isArray(body.states))throw Error();
   if(epoch!==generation.current)return;
   const next:States={};
   for(const s of body.states)if(/^[a-f0-9]{32}$/.test(s.page_id)&&typeof s.confirmed==='boolean'&&Number.isSafeInteger(s.version))next[s.page_id]={confirmed:s.confirmed,version:s.version};
   if(!initialized.current){
    let local:States={};
    try{
     const saved=localStorage.getItem(KEY);
     if(saved){const parsed=JSON.parse(saved);for(const [id,s] of Object.entries(parsed) as [string,State][]){if(/^[a-f0-9]{32}$/.test(id)&&s&&typeof s.confirmed==='boolean'&&Number.isSafeInteger(s.version)&&s.version>=0)local[id]=s;}}
     else{const legacy=JSON.parse(localStorage.getItem(LEGACY)||'[]');if(Array.isArray(legacy))for(const url of legacy){const id=surveyPageId(url);if(id&&!next[id])local[id]={confirmed:true,version:0};}}
    }catch{local={};}
    store(local);initialized.current=true;
   }
   setStates(next);setReady(true);
  }catch{setMessage('共有の確認状態を取得できませんでした。接続後に再読み込みしてください。');}
  finally{inFlight.current=false;}
 },[store]);
 useEffect(()=>{
  const initial=setTimeout(()=>void load(),0);const refresh=()=>{if(document.visibilityState==='visible')void load();};
  window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);
  return()=>{clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[load]);
 const isConfirmed=(url:string)=>{const id=surveyPageId(url);return !!(id&&(drafts[id]??states[id])?.confirmed);};
 const toggle=(url:string)=>{
  const id=surveyPageId(url);if(!id||!ready||savingRef.current)return;
  const current=draftRef.current[id]??states[id]??{confirmed:false,version:0};
  const next={...draftRef.current,[id]:{confirmed:!current.confirmed,version:current.version}};
  if(next[id].confirmed===(states[id]?.confirmed??false))delete next[id];
  store(next);setMessage('');
 };
 const save=async()=>{
  if(savingRef.current||!ready||!Object.keys(draftRef.current).length)return;
  savingRef.current=true;generation.current++;setSaving(true);setMessage('');setLoginNeeded(false);
  const changes=Object.entries(draftRef.current).map(([pageId,s])=>({pageId,...s}));
  try{
   const r=await fetch('/api/interview-surveys/confirmations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes})});
   const body=await r.json();
   if(!r.ok){
    if(r.status===401){setLoginNeeded(true);throw Error('保存するには職員ログインが必要です。変更はこの端末に残っています。');}
    if(r.status===409){
     const latest=await fetch('/api/interview-surveys/confirmations',{cache:'no-store'});const data=await latest.json();
     if(latest.ok&&Array.isArray(data.states)){
      const next:States=Object.fromEntries(data.states.map((s:{page_id:string;confirmed:boolean;version:number})=>[s.page_id,{confirmed:s.confirmed,version:s.version}]));
      setStates(next);store(Object.fromEntries(Object.entries(draftRef.current).map(([id,s])=>[id,{...s,version:next[id]?.version??0}])));
     }
    }
    throw Error(body.error||'保存できませんでした。変更を残しています。再試行してください。');
   }
   store({});try{localStorage.removeItem(LEGACY);}catch{}
   setStates(current=>({...current,...Object.fromEntries(changes.map(c=>[c.pageId,{confirmed:c.confirmed,version:c.version+1}]))}));
   setMessage('確認状態を保存しました。他の先生にも共有されます。');
  }catch(e){setMessage(e instanceof Error?e.message:'保存できませんでした。変更を残しています。');}
  finally{savingRef.current=false;setSaving(false);void load();}
 };
 return {isConfirmed,toggle,save,ready,saving,message,loginNeeded,pending:Object.keys(drafts).length};
}
