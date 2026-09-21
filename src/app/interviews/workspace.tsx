'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {studentPreviewState,studentPreviewOperation} from '@/lib/interview-student-preview';
import FlowDialog from '@/components/flow-dialog';
import styles from './interviews.module.css';
type Time={date:string;start:string;end:string};
type Slot=Time&{id:string;studentId:string};
type RequestRow={id:string;studentId:string;status:string;version:number;choices:(Time&{slotId:string})[];note:string;reason:string;confirmed:(Time&{status:string})|null};
type State={students:{id:string;name:string;teacher?:string}[];slots:Slot[];requests:RequestRow[]};
type Operation={operationKey:string;action:string;[key:string]:unknown};
export function describe(d:Time){return `${new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Tokyo'}).format(new Date(d.date+'T12:00:00+09:00'))} ${d.start}〜${d.end}`;}
export default function ParentInterviews({trial=false,livePreview=false}:{trial?:boolean;livePreview?:boolean}){
 const endpoint=livePreview?'/api/staff/interview-live-preview':trial?'/api/staff/interview-trial/student':'/api/parent/interviews';
 const [state,setState]=useState<State|null>(null),[ready,setReady]=useState(false),[login,setLogin]=useState<boolean|null>(null),[message,setMessage]=useState('');
 const [studentId,setStudentId]=useState(''),[choices,setChoices]=useState<Slot[]>([]),[note,setNote]=useState(''),[review,setReview]=useState(false);
 const [busy,setBusy]=useState(false),[retry,setRetry]=useState<Operation|null>(null);const lock=useRef(false);
 const read=useCallback(async()=>{const r=await fetch(endpoint,{cache:'no-store'});const raw=await r.json();if(r.status===401){setLogin(raw.loginAvailable===true);setState(null);return;}if(!r.ok)throw Error(raw.error??'読み込めませんでした。');const b=trial?studentPreviewState(raw):raw;setState(b);setLogin(null);setStudentId(old=>b.students.some((s:{id:string})=>s.id===old)?old:b.students[0]?.id??'');},[endpoint,trial]);
 const showStatus=()=>requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'auto'}));
 useEffect(()=>{let active=true;void(async()=>{try{await read();if(active&&new URLSearchParams(location.search).get('login')==='failed')setMessage('LINEでの確認を完了できませんでした。もう一度お試しください。');}catch(e){if(active)setMessage((e as Error).message);}finally{if(active)setReady(true);}})();return()=>{active=false;};},[read]);
 async function send(op:Operation){if(lock.current)return;lock.current=true;setBusy(true);setRetry(op);setMessage('');
  try{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(trial?studentPreviewOperation(op):op)});const b=await r.json();if(!r.ok){if(r.status<500){setRetry(null);if(r.status===401){setState(null);setLogin(true);setReview(false);}if(r.status===409){setReview(false);await read();}}throw Error(b.error??'送信結果を確認できませんでした。');}
   setRetry(null);setReview(false);setChoices([]);setNote('');
   const success=op.action==='withdraw'?'予約を取り消しました。':trial?'検証用の予約希望を保存しました。':livePreview?'本番確認用の予約希望を送信しました。勉たんの「申請」に表示されます。':'予約希望を送信しました。先生の確認をお待ちください。';
   setMessage(success);showStatus();
   if(op.action==='submit'&&!trial&&b.request){
    setState(old=>old?{...old,requests:[b.request,...old.requests.filter(row=>row.id!==b.request.id)]}:old);
   }else{
    try{await read();}catch{setMessage(`${success} 最新の状況を読み込めませんでした。「状況を更新する」で確認してください。`);}
   }
  }catch(e){setMessage((e as Error).message||'通信を確認してください。');}finally{lock.current=false;setBusy(false);}}
 async function refresh(){if(lock.current)return;lock.current=true;setBusy(true);setMessage('');try{await read();setMessage('最新の状況に更新しました。');showStatus();}catch(e){setMessage((e as Error).message||'更新できませんでした。');showStatus();}finally{lock.current=false;setBusy(false);}}
 const frozen=busy||!!retry;
 const own=state?.requests.filter(r=>r.studentId===studentId)??[];
 const active=!trial&&own.some(r=>r.status==='pending'||r.status==='approved'&&r.confirmed&&!['cancelled','rejected','completed'].includes(r.confirmed.status)&&r.confirmed.date>=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date()));
 const slots=state?.slots.filter(s=>s.studentId===studentId)??[];
 const valid=choices.length>0&&choices.every(c=>slots.some(s=>s.id===c.id));
 const requestCards=own.filter(r=>r.status!=='cancelled').map(r=>{const cancellable=r.status==='pending'||r.status==='approved'&&r.confirmed?.status==='confirmed';return <article key={r.id} className={styles.selected}><strong>{r.status==='pending'?'承認待ち':r.status==='rejected'?'日程の再選択をお願いします':r.confirmed?.status==='cancelled'?'取消済み':r.confirmed?.status==='completed'?'実施済み':'予約確定'}</strong>{r.confirmed?<p>{describe(r.confirmed)}</p>:<ol>{r.choices.map(c=><li key={c.slotId}>{describe(c)}</li>)}</ol>}{r.reason&&<p>{r.reason}</p>}{cancellable&&<button className={styles.danger} disabled={frozen} onClick={()=>{if(window.confirm('この予約を取り消しますか？'))void send({operationKey:crypto.randomUUID(),action:'withdraw',id:r.id,version:r.version});}}>予約を取り消す</button>}</article>;});
 const notice=<>{message&&<p role="status">{message}</p>}{retry&&<><p>送信結果を確認できていません。</p><button disabled={busy} onClick={()=>void send(retry)}>送信結果を再確認する</button></>}</>;
 return <main className={styles.screen}><h1>面談予約</h1><p>オンライン・45分</p>{trial&&<p className={styles.notice}>生徒役の検証用です。架空の日程で申請を試せます。実予約・Notion登録・LINE通知は行いません。</p>}{livePreview&&<p className={styles.notice}>本番と同じ申請・先生承認・Notion登録を確認する画面です。確認用生徒の予約として登録され、実際の面談ではありません。</p>}
 {!review&&message&&<p role="status" className={styles.notice}>{message}</p>}
 {!ready?<p>読み込んでいます…</p>:login!==null?<section className={styles.panel}><p>{trial||livePreview?'LINEの個別メニューから開き直してください。':login?'LINEに登録されているお子さまの面談を申し込めます。':'面談予約の受付は準備中です。日程については教室へお問い合わせください。'}</p>{login&&!trial&&!livePreview&&<a className={styles.button} href="/api/parent/line/login">LINEで続ける</a>}</section>:!state?<button onClick={()=>void read().catch(e=>setMessage(e.message))}>もう一度読み込む</button>:state.students.length===0?<section className={styles.panel}><p>お子さまとの登録を確認できませんでした。教室へLINEでご連絡ください。</p></section>:<>
 <section className={styles.panel}>{state.students.length>1?<label>お子さま<select disabled={frozen} value={studentId} onChange={e=>{setStudentId(e.target.value);setChoices([]);setNote('');}}>{state.students.map(s=><option key={s.id} value={s.id}>{s.name}さん</option>)}</select></label>:<h2>{state.students[0].name}さんの面談</h2>}
 {!trial&&(state.students.find(s=>s.id===studentId)?.teacher?<p>担任：{state.students.find(s=>s.id===studentId)?.teacher}先生<br/>明日以降の空き日程を自動で表示しています。</p>:<p>担任の登録を確認できません。教室へLINEでご連絡ください。</p>)}
 {trial?<details open={!!message}><summary>これまでの検証申請（{own.filter(r=>r.status!=='cancelled').length}件）</summary>{requestCards}</details>:requestCards}
 <button disabled={frozen} onClick={()=>void refresh()}>{busy?'更新中…':'状況を更新する'}</button>
 <><h2>{active?'担任の空き日程':'希望の日程を選ぶ'}</h2><p>{active?'新しい希望を送る場合は、現在の申請・予約を取り消してから選んでください。':'第1希望から順に、最大3つ選んでください。1つでも申し込めます。'}</p>
 {slots.length===0?<p className={styles.empty}>現在、受付中の日程はありません。</p>:<div className={styles.slots}>{slots.map(slot=>{const rank=choices.findIndex(c=>c.id===slot.id);return <button key={slot.id} className={styles.slot} disabled={active||frozen||rank<0&&choices.length===3} aria-pressed={rank>=0} onClick={()=>setChoices(old=>rank>=0?old.filter(c=>c.id!==slot.id):[...old,slot])}><span>{describe(slot)}</span>{rank>=0&&<span className={styles.rank}>第{rank+1}希望</span>}</button>;})}</div>}
 {!active&&<>
 {choices.length>0&&<div className={styles.selected} aria-label="選択した希望日程"><ol>{choices.map((c,i)=><li key={c.id}>{describe(c)}<div>{i>0&&<button disabled={frozen} onClick={()=>setChoices(old=>{const next=[...old];[next[i-1],next[i]]=[next[i],next[i-1]];return next;})}>優先順を上げる</button>}<button disabled={frozen} onClick={()=>setChoices(old=>old.filter(s=>s.id!==c.id))}>外す</button></div></li>)}</ol></div>}
 <details><summary>相談したいことを記入する（任意）</summary><label>相談内容<textarea maxLength={1500} disabled={frozen} value={note} onChange={e=>setNote(e.target.value)}/></label></details>
 <div className={styles.actions}><button className={styles.primary} disabled={frozen||!valid} onClick={()=>setReview(true)}>選んだ日程を確認する</button></div><small>先生が確認し、希望の中から1つの日程を確定します。</small></>}</>
 {retry&&!review&&<div className={styles.notice}>{notice}</div>}
 </section><footer className={styles.footer}><button disabled={frozen} onClick={()=>void(async()=>{if(lock.current)return;lock.current=true;setBusy(true);try{const r=await fetch(trial||livePreview?'/api/staff/session':'/api/parent/interviews',{method:'DELETE'});if(!r.ok&&r.status!==401)throw Error('終了できませんでした。もう一度お試しください。');setState(null);setChoices([]);setNote('');setStudentId('');setLogin(true);setMessage('');}catch(e){setMessage((e as Error).message);}finally{lock.current=false;setBusy(false);}})()}>終了する</button></footer></>}
 {review&&state&&<FlowDialog label="予約希望の確認" onBack={()=>setReview(false)} blocked={frozen} notice={notice}><h2>この希望日程で送信しますか？</h2><p>{state.students.find(s=>s.id===studentId)?.name}さん ／ オンライン・45分</p><ol>{choices.map(c=><li key={c.id}>{describe(c)}</li>)}</ol>{note&&<p>{note}</p>}<p>送信後は承認待ちになります。</p><button className={styles.primary} disabled={frozen||!valid} aria-live="polite" onClick={()=>void send({operationKey:crypto.randomUUID(),action:'submit',studentId,choices:choices.map(c=>c.id),note})}>{busy?'送信中…':'予約希望を送信する'}</button></FlowDialog>}
 </main>;
}
