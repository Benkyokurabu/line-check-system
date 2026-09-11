'use client';
import {useState} from 'react';
import {getJapanDate,isValidReservationDate} from '@/lib/reservation-date.mjs';
import type {ProxyProps} from './staff-proxy-reception';
import styles from './staff-study-room.module.css';
type Row={id:string;student_number:string;student_name:string;grade:string;reservation_date:string;seat:number;slot_ids:string[];status:string;version:number};
type Operation={operationKey:string;requestId:string;expectedVersion:number;action:'cancel';reason:string};
const normalize=(value:string)=>value.normalize('NFKC').replace(/[\s　]/g,'').toLowerCase();
export default function StaffProxyCancel({busy,request,work,onPending,onDone}:ProxyProps){
 const [date,setDate]=useState(getJapanDate()),[query,setQuery]=useState('');
 const [rows,setRows]=useState<Row[]|null>(null),[selected,setSelected]=useState<Row|null>(null);
 const [channel,setChannel]=useState('電話'),[reason,setReason]=useState(''),[notice,setNotice]=useState('');
 const [pending,setPending]=useState<Operation|null>(null);
 const frozen=busy||!!pending;
 const clear=()=>{setRows(null);setSelected(null);setNotice('');};
 async function search(){await work(async()=>{
  clear();const all:Row[]=[];
  for(let offset=0;offset<5000;offset+=50){
   const params=new URLSearchParams({date,offset:String(offset)});
   const result=await request(`/api/staff/study-room/requests?${params}`) as {requests:Row[];hasMore:boolean;permissions:Record<string,boolean>};
   if(!result.permissions?.['study_room.cancel'])throw new Error('予約を取り消す権限がありません。');
   all.push(...result.requests);
   if(!result.hasMore){const term=normalize(query);setRows(all.filter(row=>row.reservation_date===date&&['pending','approved'].includes(row.status)&&(normalize(row.student_name).includes(term)||normalize(row.student_number).includes(term))));return;}
  }
  throw new Error('対象日の予約が多いため一覧を取得できません。管理者に確認してください。');
 });}
 async function cancel(operation:Operation){await work(async()=>{
  setPending(operation);onPending(true);setNotice('');
  try{await request('/api/staff/study-room/transition',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation)});}
  catch(error){const status=(error as {status?:number}).status;
   if(status&&status<500){setPending(null);onPending(false);setRows(null);setSelected(null);throw error;}
   setNotice('取消の結果を確認できません。「同じ取消の結果を再確認」を押してください。');return;
  }
  setPending(null);onPending(false);setSelected(null);setReason('');setRows(items=>items?.filter(row=>row.id!==operation.requestId)??null);
  setNotice('生徒の代わりに取消を保存しました。');await onDone(date);
 });}
 return <section aria-label="職員による代理取消" className={styles.card}>
  <h2>生徒の予約を代わりに取り消す</h2><p>電話・LINEなどで取消を頼まれたときに使います。利用日と生徒を指定し、取り消す予約を選んでください。</p>
  {notice&&<p role="status" className={styles.notice}>{notice}</p>}
  <div className={styles.toolbar}>
   <label className={styles.field}>取消する予約の利用日<input type="date" value={date} disabled={frozen} onChange={e=>{setDate(e.target.value);clear();}}/></label>
   <label className={styles.field}>取消する生徒の氏名・学籍番号<input maxLength={64} value={query} disabled={frozen} onChange={e=>{setQuery(e.target.value);clear();}}/></label>
   <button disabled={frozen||!isValidReservationDate(date)||!query.trim()} onClick={()=>void search()}>予約を探す</button>
  </div>
  {rows?.length===0&&<p>この生徒・利用日に、取り消せる予約や申請はありません。</p>}
  {rows?.map(row=><div className={styles.card} key={row.id}>
   <span className={styles.status}>{row.status==='approved'?'予約確定':'承認待ち'}</span><h3>{row.student_name} さん（{row.grade}・{row.student_number}）</h3>
   <div className={styles.requestSeat}><strong>{row.seat}番席</strong><div><b>{row.slot_ids.map(slot=>slot.replace('-','–')).join(' ／ ')}</b><p>{row.reservation_date}</p></div></div>
   <button disabled={frozen} onClick={()=>{setSelected(row);setReason('');setNotice('');}}>この予約の取消へ</button>
  </div>)}
  {selected&&<form className={styles.confirm} aria-label="代理取消の確認" onSubmit={e=>{e.preventDefault();if(!frozen&&reason.trim())void cancel({operationKey:crypto.randomUUID(),requestId:selected.id,expectedVersion:selected.version,action:'cancel',reason:`${channel}で受けた代理取消：${reason.trim()}`});}}>
   <h3>取り消す内容</h3><p>{selected.student_name} さん ／ {selected.reservation_date} ／ {selected.seat}番席<br/>{selected.slot_ids.map(slot=>slot.replace('-','–')).join(' ／ ')}</p><p>この申請に含まれるすべての時間帯を取り消します。</p>
   <label className={styles.field}>取消依頼の連絡方法<select value={channel} disabled={frozen} onChange={e=>setChannel(e.target.value)}>{['電話','LINE','来室時','その他'].map(value=><option key={value}>{value}</option>)}</select></label>
   <label className={styles.field}>取消依頼の内容（必須）<textarea required maxLength={1800} placeholder="例：保護者から、都合が悪くなったため取消の依頼" value={reason} disabled={frozen} onChange={e=>setReason(e.target.value)}/></label>
   <div className={styles.actions}><button className={styles.primary} disabled={frozen||!reason.trim()}>取消を確定する</button><button type="button" disabled={frozen} onClick={()=>setSelected(null)}>戻る</button></div>
  </form>}
  {pending&&<button disabled={busy} onClick={()=>void cancel(pending)}>同じ取消の結果を再確認</button>}
 </section>;
}
