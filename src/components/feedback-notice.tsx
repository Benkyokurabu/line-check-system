'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import styles from './feedback-notice.module.css';
export default function FeedbackNotice(){
 const [count,setCount]=useState<number|null>(null);
 const [hiddenForOtherStaff,setHiddenForOtherStaff]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  async function refresh(){
   try{
    const response=await fetch('/api/private-feedback/summary',{cache:'no-store',signal:controller.signal});
    const body=await response.json();
    if(!controller.signal.aborted){setCount(response.ok&&Number.isSafeInteger(body.unreviewedCount)?body.unreviewedCount:null);setHiddenForOtherStaff(response.status===403);}
   }catch{if(!controller.signal.aborted)setCount(null);}
  }
  void refresh();
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);
  const focus=()=>void refresh();window.addEventListener('focus',focus);
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);};
 },[]);
 if(hiddenForOtherStaff)return null;
 return <section className={styles.notice} aria-label="工藤専用の改善要望">
  <div><strong>工藤専用</strong><span aria-live="polite">{count===null?'改善要望の確認':count>0?`未確認の改善要望が${count}件あります`:'未確認の改善要望はありません'}</span></div>
  <Link href="/private-feedback" prefetch={false}>改善要望を確認する{count!==null&&count>0&&<b>{count}</b>}<span aria-hidden="true"> →</span></Link>
 </section>;
}
