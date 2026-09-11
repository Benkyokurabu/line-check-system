'use client';
import {useEffect,useRef,useState, type FormEvent} from 'react';
import {getJapanDate} from '@/lib/reservation-date.mjs';
import styles from '../menu-preview/reservation-demo.module.css';
import ReservationPicker from './reservation-picker';
import {STUDY_ROOM_TRIAL_SLOTS as slots} from '@/lib/study-room-trial-slots.mjs';
import StaffEntry from '@/app/staff/self-study-room/staff-entry';
import statusStyles from './student-status.module.css';
type Staff={displayName:string;role:string;staffCode:string};
type Row={id:string;reservation_date:string;seat:number;slot_ids:string[];status:string;version:number};
type Options={studentName:string;requests:Row[];booked:{seat:number;slotId:string}[];closedSlotIds:string[]};

const labels:Record<string,string>={pending:'承認待ち',approved:'予約確定',rejected:'却下',cancelled:'取消済み'};
export default function StudentTrial({entryCode=''}:{entryCode?:string}){
 const [staff,setStaff]=useState<Staff|null>(null),[checked,setChecked]=useState(false);
 const [code,setCode]=useState(entryCode),[password,setPassword]=useState('');
 const [date,setDate]=useState(getJapanDate()),[selected,setSelected]=useState<string[]>([]),[seat,setSeat]=useState<number|null>(null);
 const [options,setOptions]=useState<Options|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 const [pending,setPending]=useState<Record<string,unknown>|null>(null);
 const running=useRef(false);
 const [syncError,setSyncError]=useState('');
 const [bookingOpen,setBookingOpen]=useState(false);
 useEffect(()=>{
   if(!staff||busy||pending||!date)return;
   let disposed=false,inFlight=false;
   const controller=new AbortController();
   async function sync(){
     if(inFlight||document.visibilityState==='hidden')return;
     inFlight=true;
     try{
       const response=await fetch(`/api/staff/study-room-trial/student?date=${date}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
       if(disposed)return;
       if(response.status===401){setStaff(null);setOptions(null);setSelected([]);setSeat(null);setConfirm(false);setNotice('もう一度ログインしてください。');return;}
       if(!response.ok)throw new Error('sync');
       const data=await response.json();
       if(!disposed){setOptions(data);setSyncError('');}
     }catch{if(!disposed)setSyncError('最新の状況を確認できません。通信が戻ると自動で再確認します。');}
     finally{inFlight=false;}
   }
   void sync();
   const timer=setInterval(()=>void sync(),5000);
   const resume=()=>void sync();
   window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
   return()=>{disposed=true;controller.abort();clearInterval(timer);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
 },[staff,busy,pending,date]);
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
   setPending(null);setConfirm(false);setSelected([]);setSeat(null);setBookingOpen(false);setNotice(operation.action==='cancel'?'取消を保存しました。':'');await refresh();
 });}
 const frozen=busy||!!pending;
 const blocked=(slot:string)=>options?.closedSlotIds.includes(slot)||options?.booked.some(b=>b.seat===seat&&b.slotId===slot)||options?.requests.some(r=>r.reservation_date===date&&['pending','approved'].includes(r.status)&&r.slot_ids.includes(slot));
 const valid=!!options&&seat!==null&&selected.length>0&&selected.every(s=>slots.includes(s))&&selected.every(s=>!blocked(s))&&date>=getJapanDate();
 const hasActive=options?.requests.some(row=>row.reservation_date>=getJapanDate()&&['pending','approved'].includes(row.status));
 return <main className={styles.screen}><section className={styles.panel}>
  <span className={styles.badge}>操作確認用・実際の予約やLINE通知は行いません</span>
  <h1>勉強クラブ本校<br/>自習室予約</h1>
  {notice&&<p role="status" className={styles.notice}>{notice}</p>}
  {!checked?<p>ログイン状態を確認しています…</p>:!staff?<form onSubmit={login}>
   <StaffEntry code={code} onChange={value=>{setCode(value);setPassword('');}} disabled={busy}/>
   {code&&<><label className={styles.field}>パスワード<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
   <button disabled={busy} className={styles.primary}>ログイン</button></>}
  </form>:<>
   <div className={styles.actions}><p>{staff.displayName} さんの予約</p><button disabled={frozen} onClick={()=>work(async()=>{await api('/api/staff/session',{method:'DELETE'});setStaff(null);setOptions(null);setSelected([]);setSeat(null);setConfirm(false);})}>ログアウト</button></div>
   <section aria-label="申請・予約の状況" className={statusStyles.reservations}>
    <h2>あなたの予約状況</h2>
    <p className={statusStyles.hint}>承認状況は自動で更新されます。</p>
    {syncError&&<p role="alert" className={styles.notice}>{syncError}</p>}
    <div aria-live="polite" aria-atomic="true">
    {options?.requests.filter(row=>row.reservation_date>=getJapanDate()&&['pending','approved'].includes(row.status)).map(row=><article key={row.id} className={`${statusStyles.card} ${row.status==='approved'?statusStyles.approved:statusStyles.waiting}`}>
     <strong>{labels[row.status]}</strong>
     <h2>{row.status==='approved'?'予約が確定しました':'申請を受け付けました'}</h2>
     <p>{row.status==='approved'?'下の日時・座席でご利用ください。':'職員の承認をお待ちください。まだ席は確保されていません。'}</p>
     <dl><div><dt>利用日</dt><dd>{row.reservation_date}</dd></div><div><dt>時間</dt><dd>{row.slot_ids.map(slot=><div key={slot}>{slot.replace('-','–')}</div>)}</dd></div><div><dt>場所・座席</dt><dd>本校自習室 · <b>{row.seat}番席</b></dd></div></dl>
     <button disabled={frozen} onClick={()=>{if(window.confirm('この確認用申請を取り消しますか？'))void apply({action:'cancel',operationKey:crypto.randomUUID(),requestId:row.id,expectedVersion:row.version,date});}}>この申請を取り消す</button>
    </article>)}
    </div>
   </section>
   {hasActive&&!bookingOpen&&!confirm&&<button onClick={()=>setBookingOpen(true)} disabled={frozen}>別の日時で予約する</button>}
   {(!hasActive||bookingOpen||confirm)&&<div className={styles.steps} aria-label="予約の流れ"><span className={!confirm?styles.current:''}>① 日時・席</span><span className={confirm?styles.current:''}>② 内容確認</span><span>③ 承認待ち</span><span>④ 予約確定</span></div>}
   {!confirm&&(!hasActive||bookingOpen)&&<>
    <label className={styles.field}>利用日<input type="date" min={getJapanDate()} value={date} disabled={frozen} onChange={e=>{setDate(e.target.value);setOptions(null);setSelected([]);setSeat(null);}}/></label>
    <button disabled={frozen||!date} onClick={()=>work(async()=>{await refresh();setNotice('最新の空席・申請状況に更新しました。');})}>空席・申請状況を更新</button>
    {options&&<><ReservationPicker selected={selected} seat={seat} disabled={frozen} booked={options.booked} closedSlotIds={options.closedSlotIds} ownSlotIds={options.requests.filter(r=>r.reservation_date===date&&['pending','approved'].includes(r.status)).flatMap(r=>r.slot_ids)} onSelect={(selection,chosen)=>{setSelected(selection);setSeat(chosen);}}/>
    <button className={styles.primary} disabled={frozen||!valid} onClick={()=>setConfirm(true)}>申請内容を確認する</button></>}
   </>}
   {confirm&&<><h2>この内容で申請しますか？</h2><dl className={styles.summary} aria-label="予約内容">
    <div><dt>生徒名</dt><dd><strong>{staff.displayName} さん</strong></dd></div><div><dt>教室</dt><dd>本校自習室</dd></div>
    <div><dt>利用日</dt><dd>{date}</dd></div><div><dt>座席</dt><dd>{seat}番席</dd></div><div><dt>時間帯</dt><dd>{selected.map(slot=><div key={slot}>{slot.replace('-','–')}</div>)}</dd></div>
    <div><dt>合計時間</dt><dd>{selected.length}コマ・{selected.length*90}分<span className={styles.summaryNote}>休憩時間を除く</span></dd></div><div><dt>申請区分</dt><dd>{date===getJapanDate()?'当日申請':'事前申請'}</dd></div>
   </dl><p>申請しただけでは予約は確定しません。職員の確認・承認をお待ちください。</p>
    <button className={styles.primary} disabled={frozen||!valid} onClick={()=>apply({action:'submit',operationKey:crypto.randomUUID(),date,seat,slotIds:[...selected].sort()})}>この内容で申請する</button>
    <div className={styles.actions}><button disabled={frozen} onClick={()=>setConfirm(false)}>選び直す</button></div>
   </>}
   {pending&&<button disabled={busy} onClick={()=>apply(pending)}>同じ操作の結果を再確認</button>}
  </>}
 </section></main>;
}
