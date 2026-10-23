'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {usePathname} from 'next/navigation';
import {checkedAnalysis,diagnosticFacts,operationAreas} from '@/lib/operation-diagnostics.mjs';
import {observeOperations,type Diagnostic,type OperationSignal} from '@/lib/operation-observer';
import styles from './operation-feedback.module.css';
type Entry={signal:OperationSignal;host:HTMLDivElement;analysis?:{assessment:string;nextStep:string};analysisState:'pending'|'ready'|'unavailable'};
export default function OperationFeedback(){
 const pathname=usePathname(),[entries,setEntries]=useState<Entry[]>([]);
 const hosts=useRef(new Map<string,HTMLDivElement>()),latest=useRef(new Map<string,OperationSignal>());
 const controllers=useRef(new Map<string,AbortController>());
 useLayoutEffect(()=>{
  let mounted=true;
  const controllerMap=controllers.current,hostMap=hosts.current,latestMap=latest.current;
  const hostFor=(signal:OperationSignal)=>{
   let host=hosts.current.get(signal.key);
   if(host?.isConnected)return host;
   host=document.createElement('div');host.dataset.operationFeedback='true';host.className=styles.host;
   const anchor=signal.anchor?.isConnected?signal.anchor:null;
   if(anchor)anchor.insertAdjacentElement('afterend',host);
   else (document.querySelector('main')??document.getElementById('app-content')??document.body).prepend(host);
   hosts.current.set(signal.key,host);return host;
  };
  const analyze=async(signal:OperationSignal)=>{
   controllers.current.get(signal.key)?.abort();
   const controller=new AbortController();controllers.current.set(signal.key,controller);
   const timer=setTimeout(()=>controller.abort(),12_000);
   let analysis:Entry['analysis'];
   try{
    const response=await fetch('/api/operation-analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(signal.diagnostic),signal:controller.signal});
    if(response.ok){const body=await response.json();if(body.label==='AIによる分析')analysis=checkedAnalysis(body.analysis);}
   }catch{}finally{clearTimeout(timer);if(controllers.current.get(signal.key)===controller)controllers.current.delete(signal.key);}
   if(mounted&&latest.current.get(signal.key)?.request===signal.request)setEntries(rows=>rows.map(row=>row.signal.key===signal.key?{...row,analysis,analysisState:analysis?'ready':'unavailable'}:row));
  };
  const receive=(signal:OperationSignal)=>{
   const previous=latest.current.get(signal.key);
   if(signal.phase==='responded'&&(!previous||(previous.action===signal.action&&previous.phase==='failure')))return;
   if(previous?.request===signal.request&&previous.phase==='failure')return;
   latest.current.set(signal.key,signal);
   const host=hostFor(signal);
   if(signal.phase!=='failure')controllers.current.get(signal.key)?.abort();
   setEntries(rows=>{
    const other=rows.filter(row=>row.signal.key!==signal.key);
    return [...other,{signal,host,analysisState:signal.phase==='failure'?'pending':'unavailable'}];
   });
   if(signal.phase==='failure')void analyze(signal);
  };
  const stop=observeOperations(receive);
  return ()=>{mounted=false;stop();for(const c of controllerMap.values())c.abort();controllerMap.clear();
   for(const host of hostMap.values())host.remove();hostMap.clear();latestMap.clear();};
 },[pathname]);
 // Removed portal targets remain invisible after navigation; new page operations
 // replace them. No scroll, focus, field value or business state is changed here.
 function dismiss(key:string){controllers.current.get(key)?.abort();controllers.current.delete(key);latest.current.delete(key);
  setEntries(rows=>rows.filter(row=>row.signal.key!==key));hosts.current.get(key)?.remove();hosts.current.delete(key);}
 return <>{entries.filter(e=>e.host.isConnected).map(entry=>createPortal(<section className={styles.panel} aria-label="操作の状況説明" aria-live="polite" data-operation-feedback="true">
  <button type="button" className={styles.close} aria-label="この状況説明を閉じる" onClick={()=>dismiss(entry.signal.key)}>×</button>
  {entry.signal.phase==='waiting'?<p>処理の応答を待っています。まだ結果を確認できていません。入力や選択はそのままでお待ちください。</p>
   :entry.signal.phase==='responded'?<p>接続先から応答が届きました。処理の結果は、この画面の一覧や結果表示で確認してください。</p>
   :<Failure entry={entry}/>}
 </section>,entry.host,entry.signal.key))}</>;
}
function Failure({entry}:{entry:Entry}){
 const facts=diagnosticFacts(entry.signal.diagnostic as Diagnostic),area=operationAreas[entry.signal.diagnostic.area as keyof typeof operationAreas];
 return <><p><strong>{area}の状況</strong>：{facts.observation}</p>
  {entry.analysisState==='pending'?<p className={styles.ai}>AIが、今回の通信状況をもとに説明を作成しています…</p>
   :entry.analysisState==='ready'&&entry.analysis?<div className={styles.ai}><strong>AIによる分析 <small>（原因の推定を含みます）</small></strong><p>{entry.analysis.assessment}</p><p>{entry.analysis.nextStep}</p></div>
   :<p className={styles.ai}>AIの分析を取得できませんでした。上の説明は、実際に確認できた通信・画面の状態に基づいています。</p>}
  <p>{facts.outcome}</p><details><summary>確認できた状況</summary><p>{facts.elapsed} {entry.signal.diagnostic.status?`／HTTP ${entry.signal.diagnostic.status}`:''}</p><p>{facts.certainty}</p></details>
 </>;
}
