"use client";
import {useEffect,useState} from 'react';
import {getJapanDate} from '@/lib/reservation-date.mjs';
import styles from './staff-study-room.module.css';
export type Visit={version:number;started_at:string|null;ended_at:string|null;destination:string|null;confirmed_at:string;staff_name:string};
type Operation={operationKey:string;requestId:string;expectedVersion:number;startedAt:string|null;endedAt:string|null;destination:string|null;reason:string};
type Props={row:{id:string;student_name:string;reservation_date:string;visit?:Visit|null};busy:boolean;
  request:(url:string,init?:RequestInit)=>Promise<unknown>;work:(task:()=>Promise<void>)=>Promise<void>;onClose:()=>void;onDone:()=>Promise<void>};
export const destinations:Record<string,string>={lesson:'授業へ移動',home:'帰宅',other:'その他・未確認'};
function time(value:string|null|undefined) {return value ? new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)) : '';}
export default function StaffVisit({row,busy,request,work,onClose,onDone}:Props) {
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  function fillNow(setValue:(value:string)=>void) {const instant=new Date();setNow(instant.getTime());setValue(time(instant.toISOString()));}
  const [start,setStart]=useState(time(row.visit?.started_at));
  const [end,setEnd]=useState(time(row.visit?.ended_at));
  const [destination,setDestination]=useState(row.visit?.destination??'');
  const [reason,setReason]=useState('');const [confirm,setConfirm]=useState(false);
  const [pending,setPending]=useState<Operation|null>(null);const [notice,setNotice]=useState('');
  const toInstant=(value:string,original:string|null|undefined)=>!value ? null : value===time(original) && original ? original : `${row.reservation_date}T${value.length===5?value+':00':value}+09:00`;
  const startedAt=toInstant(start,row.visit?.started_at), endedAt=toInstant(end,row.visit?.ended_at);
  const correction=!!row.visit && !(startedAt===row.visit.started_at && !row.visit.ended_at && !!endedAt);
  const valid=(!!startedAt || !!row.visit) && (!endedAt || (!!startedAt && !!destination && Date.parse(endedAt)>=Date.parse(startedAt)))
    && (!correction || !!reason.trim()) && (!startedAt || Date.parse(startedAt)<=now) && (!endedAt || Date.parse(endedAt)<=now);
  async function save(value:Operation) {
    await work(async()=>{
      setPending(value);setNotice('');
      try {await request('/api/staff/study-room/visits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});}
      catch(error) {
        const status=(error as {status?:number}).status;
        if(status && status<500) {setPending(null);setConfirm(false);if(status===409) await onDone();throw error;}
        setNotice('結果を確認できません。同じ記録の結果を再確認してください。');return;
      }
      setPending(null);await onDone();
    });
  }
  return <section className={styles.card} aria-label="来室・退室の記録"><h2>来室・退室の記録</h2>
    <p>{row.student_name} さん</p><p>利用日：{row.reservation_date}（時刻は日本時間）</p>
    <p>実際に確認した時刻を入力してください。予約時刻から自動で出席・帰宅にはしません。</p>
    {notice && <p role="status">{notice}</p>}
    <form onSubmit={e=>{e.preventDefault();if(valid && !busy && !pending)setConfirm(true);}}>
      <fieldset disabled={busy || !!pending || confirm} className={styles.form}>
        <label className={styles.field}>実際の利用開始<input type="time" step="1" value={start} onChange={e=>setStart(e.target.value)}/></label>
        <button type="button" disabled={row.reservation_date!==getJapanDate(new Date(now))} onClick={()=>fillNow(setStart)}>現在時刻を開始欄へ入れる</button>
        <label className={styles.field}>実際の利用終了<input type="time" step="1" value={end} onChange={e=>{setEnd(e.target.value);if(!e.target.value)setDestination('');}}/></label>
        <button type="button" disabled={row.reservation_date!==getJapanDate(new Date(now))} onClick={()=>fillNow(setEnd)}>現在時刻を終了欄へ入れる</button>
        <label className={styles.field}>退室後の移動先<select value={destination} disabled={!end} onChange={e=>setDestination(e.target.value)}><option value="">選んでください</option>{Object.entries(destinations).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className={styles.field}>記録・訂正の理由{correction?'（必須）':'（任意）'}<textarea maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      </fieldset>
      {row.visit && <p>誤った来室記録は開始・終了欄を空にし、訂正理由を入力して未確認へ戻せます。履歴は消えません。</p>}
      {!valid && <p>時刻の前後・未来時刻・移動先・訂正理由を確認してください。</p>}
      {!confirm && <button className={styles.primary} disabled={busy || !!pending || !valid}>記録内容を確認</button>}
      {confirm && !pending && <div className={styles.confirm}><p>開始：{start||'未確認'}</p><p>終了：{end||'未確認'}</p><p>移動先：{end?destinations[destination]:'未記録'}</p><p>理由：{reason||'なし'}</p>
        <p>予約枠の取消、授業の出席登録、帰宅通知は行いません。</p>
        <button type="button" disabled={busy || !valid} onClick={()=>save({operationKey:crypto.randomUUID(),requestId:row.id,expectedVersion:row.visit?.version??0,startedAt,endedAt,destination:endedAt?destination:null,reason})}>確認して記録を保存</button>
        <button type="button" disabled={busy} onClick={()=>setConfirm(false)}>記録内容を修正</button></div>}
    </form>
    {pending && <button disabled={busy} onClick={()=>save(pending)}>同じ記録の結果を再確認</button>}
    <div className={styles.actions}><button disabled={busy || !!pending} onClick={onClose}>記録画面を閉じる</button></div>
  </section>;
}
