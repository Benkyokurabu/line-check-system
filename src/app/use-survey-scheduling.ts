'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {surveyPageId} from '@/lib/survey-confirmations.mjs';
export type ScheduleStatus={status:'uncontacted'|'invited'|'confirmed'|'unknown';detail:string;date?:string;start?:string;end?:string};
export function useSurveyScheduling(){
 const [states,setStates]=useState<Record<string,ScheduleStatus>>({}),[error,setError]=useState(''),[loading,setLoading]=useState(true),[updatedAt,setUpdatedAt]=useState('');
 const inFlight=useRef(false),mounted=useRef(true);
 const load=useCallback(async()=>{
  if(inFlight.current)return;inFlight.current=true;setLoading(true);
  try{const r=await fetch('/api/interview-surveys/scheduling',{cache:'no-store',signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(r.status===401?'日程状況は職員ログイン後に確認できます。':'日程状況を取得できません。再取得してください。');const b=await r.json();
   if(!b.states||typeof b.states!=='object'||Array.isArray(b.states)||Object.values(b.states).some((s)=>!s||typeof s!=='object'||!('status' in s)||!['uncontacted','invited','confirmed','unknown'].includes(String(s.status))))throw Error('日程状況の応答を確認できません。');
   if(mounted.current){setStates(b.states);setUpdatedAt(b.updatedAt);setError('');}
  }catch(e){if(mounted.current){setStates({});setError((e as Error).message);}}finally{inFlight.current=false;if(mounted.current)setLoading(false);}
 },[]);
 useEffect(()=>{mounted.current=true;const timer=setTimeout(()=>void load(),0);const refresh=()=>{if(document.visibilityState==='visible')void load();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{mounted.current=false;clearTimeout(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[load]);
 const get=(url:string):ScheduleStatus=>states[surveyPageId(url)??'']??{status:'unknown',detail:loading?'日程状況を取得中…':error||'生徒・アンケートの紐づけを確認してください。'};
 return {get,load,loading,error,updatedAt};
}
