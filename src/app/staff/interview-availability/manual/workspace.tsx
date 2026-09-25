'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import FlowDialog from '@/components/flow-dialog';
import styles from '@/app/interviews/interviews.module.css';

type Slot={pageId:string;editedAt:string;date:string;start:string;end:string;campus:string;teacher:string};
const currentMonth=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}).format(new Date());
export default function AvailabilityManual(){
 const [month,setMonth]=useState(currentMonth),[slots,setSlots]=useState<Slot[]|null>(null),[target,setTarget]=useState<(Slot&{operationKey:string})|null>(null);
 const [staff,setStaff]=useState<{displayName:string}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const load=useCallback(async(targetMonth:string)=>{const response=await fetch(`/api/staff/interview-manual-availability?month=${encodeURIComponent(targetMonth)}`,{cache:'no-store'}),body=await response.json();if(!response.ok)throw Error(body.error??'Notionの予約可を読み込めませんでした。');setSlots(body.rows??[]);},[]);
 useEffect(()=>{let active=true;void(async()=>{try{const response=await fetch('/api/staff/session',{cache:'no-store'}),body=await response.json();if(!response.ok)throw Error('予約可能枠の画面でログインしてください。');if(active){setStaff(body.staff);await load(month);}}catch(error){if(active)setMessage((error as Error).message);}})();return()=>{active=false;};},[load,month]);
 async function archive(){if(!target||busy)return;setBusy(true);setMessage('');try{const response=await fetch('/api/staff/interview-manual-availability',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'archive',pageId:target.pageId,editedAt:target.editedAt,operationKey:target.operationKey})}),body=await response.json();if(!response.ok)throw Error(body.error??'削除できませんでした。');setTarget(null);await load(month);setMessage(`${target.date} ${target.start}の予約可をNotionから削除しました。`);}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}
 return <main className={styles.screen}><Link className={styles.button} href="/staff/interview-availability">← 予約可能枠を作る画面へ</Link><header className={styles.header}><div><h1>Notionの予約可を管理</h1><p>自分の予約可を確認し、不要な枠をNotionから削除します。</p></div>{staff&&<small>{staff.displayName}</small>}</header>
 {message&&<p role="status" className={styles.notice}>{message}</p>}
 {!staff?<p>予約可能枠の画面からログインしてください。</p>:<section className={styles.panel}><label>対象月<input type="month" value={month} onChange={event=>{setMonth(event.target.value);setSlots(null);setMessage('');}}/></label><button disabled={busy} onClick={()=>{setBusy(true);setMessage('');void load(month).catch(error=>setMessage((error as Error).message)).finally(()=>setBusy(false));}}>Notionの予約可を更新</button>{slots===null?<p>読み込んでいます…</p>:slots.length===0?<p className={styles.empty}>この月の予約可はありません。</p>:<div className={styles.slots}>{slots.map(slot=><article className={styles.selected} key={slot.pageId}><strong>{slot.date} {slot.start}〜{slot.end||'（終了時刻なし）'}</strong><small>{slot.campus} ／ {slot.teacher}先生</small><div className={styles.actions}><button className={styles.danger} disabled={busy} onClick={()=>{setMessage('');setTarget({...slot,operationKey:crypto.randomUUID()});}}>この枠をNotionから削除</button></div></article>)}</div>}</section>}
 {target&&<FlowDialog label="Notionの予約可を削除" onBack={()=>setTarget(null)} blocked={busy} notice={message?<p role="status">{message}</p>:undefined}><h2>この予約可を削除しますか</h2><p>{target.date} {target.start}〜{target.end||'（終了時刻なし）'}<br/>{target.campus} ／ {target.teacher}先生</p><p>Notionのカードをアーカイブし、保護者への表示も停止します。予約・打診・申請に使用中の枠は削除できません。</p><button className={styles.danger} disabled={busy} onClick={()=>void archive()}>Notionから削除する</button></FlowDialog>}
 </main>;
}
