'use client';
import {useEffect,useRef,useState} from 'react';
import FlowDialog from '@/components/flow-dialog';
import styles from './interviews.module.css';
type Time={date:string;start:string;end:string};
type Slot=Time&{id:string;studentId:string};
type RequestRow={id:string;studentId:string;status:string;version:number;choices:(Time&{slotId:string})[];note:string;reason:string;confirmed:(Time&{status:string})|null};
type State={students:{id:string;name:string}[];slots:Slot[];requests:RequestRow[]};
type Operation={operationKey:string;action:string;[key:string]:unknown};
export function describe(d:Time){return `${new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Tokyo'}).format(new Date(d.date+'T12:00:00+09:00'))} ${d.start}〜${d.end}`;}
export default function ParentInterviews(){
 const [state,setState]=useState<State|null>(null),[ready,setReady]=useState(false),[login,setLogin]=useState<boolean|null>(null),[message,setMessage]=useState('');
 const [studentId,setStudentId]=useState(''),[choices,setChoices]=useState<Slot[]>([]),[note,setNote]=useState(''),[review,setReview]=useState(false),[withdraw,setWithdraw]=useState<RequestRow|null>(null);
 const [busy,setBusy]=useState(false),[retry,setRetry]=useState<Operation|null>(null);const lock=useRef(false);
 async function read(){const r=await fetch('/api/parent/interviews',{cache:'no-store'});const b=await r.json();if(r.status===401){setLogin(b.loginAvailable===true);setState(null);return;}if(!r.ok)throw Error(b.error??'読み込めませんでした。');setState(b);setLogin(null);setStudentId(old=>b.students.some((s:{id:string})=>s.id===old)?old:b.students[0]?.id??'');}
 useEffect(()=>{let active=true;void(async()=>{try{await read();if(active&&new URLSearchParams(location.search).get('login')==='failed')setMessage('LINEでの確認を完了できませんでした。もう一度お試しください。');}catch(e){if(active)setMessage((e as Error).message);}finally{if(active)setReady(true);}})();return()=>{active=false;};},[]);
 async function send(op:Operation){if(lock.current)return;lock.current=true;setBusy(true);setRetry(op);setMessage('');
  try{const r=await fetch('/api/parent/interviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(op)});const b=await r.json();if(!r.ok){if(r.status<500){setRetry(null);if(r.status===401){setState(null);setLogin(true);setReview(false);setWithdraw(null);}if(r.status===409){setReview(false);setWithdraw(null);await read();}}throw Error(b.error??'送信結果を確認できませんでした。');}
   setRetry(null);setReview(false);setWithdraw(null);setChoices([]);setNote('');await read();setMessage(op.action==='withdraw'?'申請を取り下げました。':'予約希望を送信しました。先生の確認をお待ちください。');
  }catch(e){setMessage((e as Error).message||'通信を確認してください。');}finally{lock.current=false;setBusy(false);}}
 const frozen=busy||!!retry;
 const own=state?.requests.filter(r=>r.studentId===studentId)??[];
 const active=own.some(r=>r.status==='pending'||r.status==='approved'&&r.confirmed&&!['cancelled','rejected','completed'].includes(r.confirmed.status)&&r.confirmed.date>=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date()));
 const slots=state?.slots.filter(s=>s.studentId===studentId)??[];
 const valid=choices.length>0&&choices.every(c=>slots.some(s=>s.id===c.id));
 const notice=<>{message&&<p role="status">{message}</p>}{retry&&<><p>送信結果を確認できていません。</p><button disabled={busy} onClick={()=>void send(retry)}>送信結果を再確認する</button></>}</>;
 return <main className={styles.screen}><h1>面談予約</h1><p>オンライン・45分</p>
 {!review&&!withdraw&&message&&<p role="status" className={styles.notice}>{message}</p>}
 {!ready?<p>読み込んでいます…</p>:login!==null?<section className={styles.panel}><p>{login?'LINEに登録されているお子さまの面談を申し込めます。':'面談予約の受付は準備中です。日程については教室へお問い合わせください。'}</p>{login&&<a className={styles.button} href="/api/parent/line/login">LINEで続ける</a>}</section>:!state?<button onClick={()=>void read().catch(e=>setMessage(e.message))}>もう一度読み込む</button>:state.students.length===0?<section className={styles.panel}><p>お子さまとの登録を確認できませんでした。教室へLINEでご連絡ください。</p></section>:<>
 <section className={styles.panel}>{state.students.length>1?<label>お子さま<select disabled={frozen} value={studentId} onChange={e=>{setStudentId(e.target.value);setChoices([]);setNote('');}}>{state.students.map(s=><option key={s.id} value={s.id}>{s.name}さん</option>)}</select></label>:<h2>{state.students[0].name}さんの面談</h2>}
 {own.filter(r=>r.status!=='cancelled').map(r=><article key={r.id} className={styles.selected}><strong>{r.status==='pending'?'承認待ち':r.status==='rejected'?'日程の再選択をお願いします':r.confirmed?.status==='cancelled'?'取消済み':r.confirmed?.status==='completed'?'実施済み':'予約確定'}</strong>{r.confirmed?<p>{describe(r.confirmed)}</p>:<ol>{r.choices.map(c=><li key={c.slotId}>{describe(c)}</li>)}</ol>}{r.reason&&<p>{r.reason}</p>}{r.status==='pending'&&<button disabled={frozen} onClick={()=>setWithdraw(r)}>申請を取り下げる</button>}</article>)}
 {own.length>0&&<button disabled={frozen} onClick={()=>void read().catch(e=>setMessage(e.message))}>状況を更新する</button>}
 {!active&&<><h2>希望の日程を選ぶ</h2><p>第1希望から順に、最大3つ選んでください。1つでも申し込めます。</p>
 {slots.length===0?<p className={styles.empty}>現在、受付中の日程はありません。</p>:<div className={styles.slots}>{slots.map(slot=>{const rank=choices.findIndex(c=>c.id===slot.id);return <button key={slot.id} className={styles.slot} disabled={frozen||rank<0&&choices.length===3} aria-pressed={rank>=0} onClick={()=>setChoices(old=>rank>=0?old.filter(c=>c.id!==slot.id):[...old,slot])}><span>{describe(slot)}</span>{rank>=0&&<span className={styles.rank}>第{rank+1}希望</span>}</button>;})}</div>}
 {choices.length>0&&<div className={styles.selected} aria-label="選択した希望日程"><ol>{choices.map((c,i)=><li key={c.id}>{describe(c)}<div>{i>0&&<button disabled={frozen} onClick={()=>setChoices(old=>{const next=[...old];[next[i-1],next[i]]=[next[i],next[i-1]];return next;})}>優先順を上げる</button>}<button disabled={frozen} onClick={()=>setChoices(old=>old.filter(s=>s.id!==c.id))}>外す</button></div></li>)}</ol></div>}
 <details><summary>相談したいことを記入する（任意）</summary><label>相談内容<textarea maxLength={1500} disabled={frozen} value={note} onChange={e=>setNote(e.target.value)}/></label></details>
 <div className={styles.actions}><button className={styles.primary} disabled={frozen||!valid} onClick={()=>setReview(true)}>選んだ日程を確認する</button></div><small>先生が確認し、希望の中から1つの日程を確定します。</small></>}
 {retry&&!review&&!withdraw&&<div className={styles.notice}>{notice}</div>}
 </section><footer className={styles.footer}><button disabled={frozen} onClick={()=>void(async()=>{if(lock.current)return;lock.current=true;setBusy(true);try{const r=await fetch('/api/parent/interviews',{method:'DELETE'});if(!r.ok&&r.status!==401)throw Error('終了できませんでした。もう一度お試しください。');setState(null);setChoices([]);setNote('');setStudentId('');setLogin(true);setMessage('');}catch(e){setMessage((e as Error).message);}finally{lock.current=false;setBusy(false);}})()}>終了する</button></footer></>}
 {review&&state&&<FlowDialog label="予約希望の確認" onBack={()=>setReview(false)} blocked={frozen} notice={notice}><h2>この希望日程で送信しますか？</h2><p>{state.students.find(s=>s.id===studentId)?.name}さん ／ オンライン・45分</p><ol>{choices.map(c=><li key={c.id}>{describe(c)}</li>)}</ol>{note&&<p>{note}</p>}<p>送信後は承認待ちになります。</p><button className={styles.primary} disabled={frozen||!valid} onClick={()=>void send({operationKey:crypto.randomUUID(),action:'submit',studentId,choices:choices.map(c=>c.id),note})}>予約希望を送信する</button></FlowDialog>}
 {withdraw&&<FlowDialog label="申請の取り下げ" onBack={()=>setWithdraw(null)} blocked={frozen} notice={notice}><p>この申請を取り下げますか？</p><button disabled={frozen} onClick={()=>void send({operationKey:crypto.randomUUID(),action:'withdraw',id:withdraw.id,version:withdraw.version})}>取り下げる</button></FlowDialog>}
 </main>;
}
