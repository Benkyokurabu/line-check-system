'use client';
import {useEffect,useRef,useState, type FormEvent} from 'react';
import {getJapanDate} from '@/lib/reservation-date.mjs';
import styles from '@/app/staff/self-study-room/staff-study-room.module.css';
import StaffEntry from '@/app/staff/self-study-room/staff-entry';
type Staff={displayName:string;role:string;staffCode:string};
type Row={id:string;reservation_date:string;seat:number;slot_ids:string[];status:string;version:number};
type Options={studentName:string;requests:Row[];booked:{seat:number;slotId:string}[];closedSlotIds:string[]};
const slots=['14:55-16:25','16:45-18:15','18:35-20:05','20:25-21:55'];
const labels:Record<string,string>={pending:'承認待ち',approved:'予約確定',rejected:'却下',cancelled:'取消済み'};
export default function StudentTrial({entryCode=''}:{entryCode?:string}){
 const [staff,setStaff]=useState<Staff|null>(null),[checked,setChecked]=useState(false);
 const [code,setCode]=useState(entryCode),[password,setPassword]=useState('');
 const [date,setDate]=useState(getJapanDate()),[selected,setSelected]=useState<string[]>([]),[seat,setSeat]=useState(1);
 const [options,setOptions]=useState<Options|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 const [pending,setPending]=useState<Record<string,unknown>|null>(null);
 const running=useRef(false);
 async function api(url:string,init?:RequestInit){
   const response=await fetch(url,{...init,cache:'no-store',credentials:'same-origin'});const data=await response.json();
   if(!response.ok){if(response.status===401){setStaff(null);setOptions(null);setSelected([]);setConfirm(false);setPending(null);}
     throw Object.assign(new Error(data.error??'処理に失敗しました。'),{status:response.status});}
   return data;
 }
 async function refresh(day=date){const data=await api(`/api/staff/study-room-trial/student?date=${day}`);setOptions(data);}
 async function work(fn:()=>Promise<void>){if(running.current)return;running.current=true;setBusy(true);try{await fn();}catch(e){setNotice(e instanceof Error?e.message:'接続できません。');}finally{running.current=false;setBusy(false);}}
 useEffect(()=>{let disposed=false;void(async()=>{try{const res=await fetch('/api/staff/session',{cache:'no-store',credentials:'same-origin'});const data=await res.json();if(disposed)return;if(res.ok){
      if(entryCode&&data.staff.staffCode!==entryCode){setNotice('この入口の利用者としてパスワードでログインしてください。');return;}
      setStaff(data.staff);
      const loaded=await fetch('/api/staff/study-room-trial/student?date='+getJapanDate(),{cache:'no-store',credentials:'same-origin'});
      const availability=await loaded.json();if(disposed)return;
      if(loaded.ok)setOptions(availability);else{if(loaded.status===401)setStaff(null);setNotice(availability.error??'空席を読み込めません。');}
    }else if(res.status!==401)setNotice(data.error??'認証を利用できません。');}catch{if(!disposed)setNotice('接続できません。');}finally{if(!disposed)setChecked(true);}})();return()=>{disposed=true;};},[entryCode]);
 async function login(e:FormEvent){e.preventDefault();await work(async()=>{const secret=password;setPassword('');const data=await api('/api/staff/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({staffCode:code,password:secret})});setStaff(data.staff);setNotice('ログインしました。空席と申請状況を読み込みます。');await refresh();});}
 async function apply(operation:Record<string,unknown>){await work(async()=>{
   setPending(operation);setNotice('');
   try{await api('/api/staff/study-room-trial/student',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation)});}
   catch(e){const status=(e as {status?:number}).status;if(status&&status<500){setPending(null);setConfirm(false);await refresh();throw e;}setNotice('結果を確認できません。同じ操作の結果を再確認してください。');return;}
   setPending(null);setConfirm(false);setSelected([]);setNotice(operation.action==='cancel'?'取消を保存しました。':'申請を受け付けました。職員が承認すると予約確定になります。');await refresh();
 });}
 const frozen=busy||!!pending;
 const blocked=(slot:string)=>options?.closedSlotIds.includes(slot)||options?.booked.some(b=>b.seat===seat&&b.slotId===slot)||options?.requests.some(r=>r.reservation_date===date&&['pending','approved'].includes(r.status)&&r.slot_ids.includes(slot));
 const valid=!!options&&selected.length>0&&selected.every(s=>!blocked(s))&&date>=getJapanDate();
 return <main className={`shell ${styles.screen}`}><section className="panel"><p className="eyebrow">生徒用・操作確認</p><h1>自習室の予約</h1>
  <div className={styles.notice}><strong>これは検証用です。実際の生徒の予約・LINE通知は発生しません。</strong><p>座席と時間帯を選んで申請できます。承認されると「予約確定」と表示されます。</p></div>
  {notice&&<p role="status" className={styles.notice}>{notice}</p>}
  {!checked?<p>ログイン状態を確認しています…</p>:!staff?<form onSubmit={login} className={styles.form}>
   <StaffEntry code={code} onChange={value=>{setCode(value);setPassword('');}} disabled={busy}/>
   {code&&<>
   <label className={styles.field}>パスワード<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
   <button disabled={busy} className={styles.primary}>ログイン</button></>}
  </form>:<>
   <div className={styles.toolbar}><p>{staff.displayName} さんの予約</p>
    
    <button disabled={frozen} onClick={()=>work(async()=>{await api('/api/staff/session',{method:'DELETE'});setStaff(null);setOptions(null);setSelected([]);setConfirm(false);})}>ログアウト</button></div>
   <p>利用日・座席・時間帯を選び、「申請内容を確認」へ進んでください。</p>
   <div className={styles.toolbar}><label className={styles.field}>利用日<input type="date" min={getJapanDate()} value={date} disabled={frozen||confirm} onChange={e=>{setDate(e.target.value);setOptions(null);setSelected([]);}}/></label>
    <button disabled={frozen||!date} onClick={()=>work(async()=>{setConfirm(false);await refresh();setNotice('最新の空席・申請状況に更新しました。');})}>空席・申請状況を更新</button></div>
   {options&&<><label className={styles.field}>座席<select value={seat} disabled={frozen||confirm} onChange={e=>{setSeat(Number(e.target.value));setSelected([]);}}>{Array.from({length:10},(_,i)=><option value={i+1} key={i}>{i+1}番席</option>)}</select></label>
   <fieldset disabled={frozen||confirm}><legend>利用する時間帯</legend>{slots.map(slot=><label key={slot} style={{display:'block',padding:'8px'}}><input type="checkbox" checked={selected.includes(slot)} disabled={!!blocked(slot)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,slot]:prev.filter(s=>s!==slot))}/>{slot}{blocked(slot)?'（選択不可）':''}</label>)}</fieldset>
   {!confirm?<button className={styles.primary} disabled={frozen||!valid} onClick={()=>setConfirm(true)}>申請内容を確認</button>:<div className={styles.card}><h2>申請内容の確認</h2><p>{staff.displayName} さんの確認用申請<br/>{date} ／ {seat}番席<br/>{selected.join('、')}</p><p>申請時点では席は確定しません。職員の承認をお待ちください。</p><button disabled={frozen||!valid} onClick={()=>apply({action:'submit',operationKey:crypto.randomUUID(),date,seat,slotIds:[...selected].sort()})}>この内容で申請</button><button disabled={frozen} onClick={()=>setConfirm(false)}>戻る</button></div>}
   <h2>自分の確認用申請</h2>{options.requests.length===0?<p>申請はありません。</p>:options.requests.map(row=><article className={styles.card} key={row.id}><strong>{labels[row.status]}</strong><p>{row.reservation_date} ／ {row.seat}番席<br/>{row.slot_ids.join('、')}</p>{['pending','approved'].includes(row.status)&&<button disabled={frozen} onClick={()=>{if(window.confirm('この確認用申請を取り消しますか？'))void apply({action:'cancel',operationKey:crypto.randomUUID(),requestId:row.id,expectedVersion:row.version,date});}}>この申請を取り消す</button>}</article>)}</>}
   {pending&&<button disabled={busy} onClick={()=>apply(pending)}>同じ操作の結果を再確認</button>}
  </>}
 </section></main>;
}
