'use client';
import {useEffect,useState} from 'react';
import styles from './trial-availability.module.css';
type Availability={date:string;slotIds:string[];closedSlotIds:string[];booked:{seat:number;slotId:string}[]};
export default function TrialAvailability({date,revision}:{date:string;revision:unknown}){
 const [data,setData]=useState<Availability|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  let disposed=false,loading=false;
  const controller=new AbortController();
  async function load(){
   if(loading||!date||document.visibilityState==='hidden')return;
   loading=true;
   try{
    const response=await fetch(`/api/staff/study-room-trial/intake-options?date=${date}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
    if(!response.ok)throw new Error('unavailable');
    const result=await response.json();
    if(result.date!==date||!Array.isArray(result.slotIds)||!Array.isArray(result.booked)||!Array.isArray(result.closedSlotIds))throw new Error('invalid');
    if(!disposed){setData(result);setError('');}
   }catch{if(!disposed){setData(null);setError('空席を取得できません。通信・ログイン状態をご確認ください。自動で再確認します。');}}
   finally{loading=false;}
  }
  void load();const timer=setInterval(()=>void load(),5000);const resume=()=>void load();
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
  return()=>{disposed=true;controller.abort();clearInterval(timer);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
 },[date,revision]);
 return <section className={styles.overview} aria-label="時間帯ごとの空席"><h2>時間帯ごとの空席</h2><p>{date} · 本校自習室（10席）</p><p>自動更新 · 承認待ちの申請は席を確保していません。</p>
 {error?<p role="alert">{error}</p>:!data?<p>空席を確認しています…</p>:<div className={styles.grid}>{data.slotIds.map(slot=>{
  const closed=data.closedSlotIds.includes(slot);
  const booked=new Set(data.booked.filter(item=>item.slotId===slot).map(item=>item.seat));
  const available=Array.from({length:10},(_,i)=>i+1).filter(seat=>!booked.has(seat));
  return <div key={slot} className={`${styles.slot} ${closed||!available.length?styles.full:styles.open}`} aria-label={`${slot.replace('-','–')} ${closed?'利用不可':`空き${available.length}席`}`}>
   <h3>{slot.replace('-','–')}</h3><strong className={styles.count}>{closed?'利用不可':available.length?`空き ${available.length}席`:'満席'}</strong>
   <p>{closed?'この時間帯は受付できません。':`予約済み ${booked.size}席 / 全10席`}</p>
   <div className={styles.seats}>{Array.from({length:10},(_,i)=>i+1).map(seat=><span key={seat} className={closed||booked.has(seat)?styles.taken:styles.free}>{seat}番<br/>{closed?'不可':booked.has(seat)?'予約済':'空き'}</span>)}</div>
  </div>;
 })}</div>}</section>;
}
