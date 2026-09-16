'use client';
import Link from 'next/link';
import FlowDialog from '@/components/flow-dialog';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import StaffEntry from '@/app/staff/self-study-room/staff-entry';
import {canAccessInterviews} from '@/lib/interview-access.mjs';
import {trialDay} from '@/lib/interview-trial.mjs';
import styles from './workspace.module.css';
type Staff={staffId:string;staffCode:string;displayName:string;role:string};
type Slot={id:string;date:string;start:string;end:string;campus:string;available?:boolean};
type Details={purpose:string;participants:string;method:string;note:string};
type Row={id:string;studentCode:string;studentName:string;status:string;version:number;choices:Slot[];details:Details;confirmed:Slot|null;proposed?:{choices:Slot[];details:Details}|null;reason?:string};
type State={requests:Row[];slots:Slot[];studentName:string};
type Operation={action:string;operationKey:string;id?:string;version?:number;[key:string]:unknown};
const names:Record<string,string>={pending:'承認待ち',approved:'予約確定',change_requested:'変更申請中',cancel_requested:'取消申請中',cancelled:'取消済み',rejected:'見送り'};
const describe=(s:Slot)=>`${s.date} ${s.start}〜${s.end} ${s.campus}`;
export default function ReservationTrial({entryCode='',view}:{entryCode?:string;view:'menu'|'student'|'staff'}){
 const [staff,setStaff]=useState<Staff|null>(null),[ready,setReady]=useState(false),[state,setState]=useState<State|null>(null);
 const [code,setCode]=useState(entryCode),[password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [campus,setCampus]=useState('本校'),[dates,setDates]=useState([trialDay(3),trialDay(4),trialDay(5)]),[choices,setChoices]=useState(['','','']);
 const [details,setDetails]=useState<Details>({purpose:'学習相談',participants:'本人、保護者',method:'対面',note:''});
 const [editing,setEditing]=useState<Row|null>(null),[reasons,setReasons]=useState<Record<string,string>>({}),[selections,setSelections]=useState<Record<string,string>>({});
 const [confirmation,setConfirmation]=useState<Operation|null>(null),[retry,setRetry]=useState<Operation|null>(null);
 const lock=useRef(false);const endpoint=`/api/staff/interview-trial/${view==='staff'?'staff':'student'}`;
 const api=useCallback(async(url:string,init?:RequestInit)=>{
  const response=await fetch(url,{...init,credentials:'same-origin',cache:'no-store'});const body=await response.json();
  if(!response.ok){if(response.status===401){setStaff(null);setState(null);}throw Object.assign(new Error(body.error??'接続を確認してください。'),{status:response.status});}return body;
 },[]);
 useEffect(()=>{let active=true;void(async()=>{try{const body=await api('/api/staff/session');if(!active)return;
  if(!canAccessInterviews(body.staff)){setMessage('現在は工藤さん・金城さんだけの操作確認です。');return;}
  if(entryCode&&body.staff.staffCode!==entryCode){setMessage('この入口の利用者としてログインしてください。');return;}setStaff(body.staff);
 }catch(e){if(active&&(e as {status?:number}).status!==401)setMessage((e as Error).message);}finally{if(active)setReady(true);}})();return()=>{active=false;};},[api,entryCode]);
 useEffect(()=>{if(!staff||view==='menu')return;let active=true,inFlight=false;
  const refresh=async()=>{if(inFlight||lock.current||document.visibilityState==='hidden')return;inFlight=true;try{const data=await api(endpoint);if(active)setState(data);}catch(e){if(active)setMessage((e as Error).message);}finally{inFlight=false;}};
  void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>{active=false;clearInterval(timer);};
 },[api,endpoint,staff,view]);
 async function login(e:FormEvent){e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
  try{const secret=password;setPassword('');const data=await api('/api/staff/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({staffCode:code,password:secret})});
   if(!canAccessInterviews(data.staff))throw Error('現在は工藤さん・金城さんだけの操作確認です。');setStaff(data.staff);
  }catch(e){setMessage((e as Error).message);}finally{lock.current=false;setBusy(false);}}
 function propose(action:string,row?:Row,extra:Record<string,unknown>={}){setMessage('');setConfirmation({operationKey:crypto.randomUUID(),action,id:row?.id,version:row?.version,...extra});}
 async function save(op:Operation){if(lock.current)return;lock.current=true;setBusy(true);setMessage('');setConfirmation(null);setRetry(op);
  try{await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(op)});setRetry(null);setEditing(null);setChoices(['','','']);setState(await api(endpoint));setMessage('保存しました。相手側の確認画面にも反映されます。');}
  catch(e){if((e as {status?:number}).status&&((e as {status:number}).status<500))setRetry(null);setMessage((e as Error).message);}
  finally{lock.current=false;setBusy(false);}}
 function submit(e:FormEvent){e.preventDefault();if(choices[2]&&!choices[1]){setMessage('第2希望を選んでから第3希望を追加してください。');return;}propose(editing?'change':'submit',editing??undefined,{...details,choices:choices.filter(Boolean)});}
 const codeQuery=staff?.staffCode??code;
 return <main className={styles.screen}>
  <span className={styles.badge}>検証用・工藤さん／金城さん限定</span>
  <h1>{view==='menu'?'予約メニュー':view==='staff'?'面談予約の確認・承認':'面談予約'}</h1>
  <p className={styles.hint}>これは検証用です。実際の予約・Notion登録・LINE通知は行いません。</p>
  {message&&<p role="status" className={styles.notice}>{message}</p>}
  {!ready?<p>ログインを確認しています…</p>:!staff?<form className={styles.panel} onSubmit={login}>
   <StaffEntry code={code} onChange={setCode} disabled={busy}/>{code&&<><label>パスワード<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>ログイン</button></>}
  </form>:<>
   <div className={styles.actions}><span>{staff.displayName} さん{view==='staff'?'（職員役）':'（生徒役）'}</span>
    <button disabled={busy||!!retry} onClick={()=>void(async()=>{try{await api('/api/staff/session',{method:'DELETE'});setStaff(null);setState(null);}catch(e){setMessage((e as Error).message);}})()}>ログアウト</button>
    {view==='staff'&&<Link href={`/staff/interviews?staff=${codeQuery}`} prefetch={false}>← 面談の予定に戻る</Link>}
    {view==='student'&&!retry&&<Link href={`/reservations/trial?staff=${codeQuery}`} prefetch={false}>← 予約メニューに戻る</Link>}
   </div>
   {view==='menu'?<div className={styles.cards}>
    <Link className={styles.card} href={`/self-study-room/trial?staff=${codeQuery}&from=menu`} prefetch={false}><span>座席・時間帯を選ぶ</span><strong>自習室予約</strong><p>申請と予約状況を確認する →</p></Link>
    <Link className={styles.card} href={`/reservations/trial?staff=${codeQuery}&kind=interview`} prefetch={false}><span>希望日時を伝える</span><strong>面談予約</strong><p>第1〜第3希望を申し込む →</p></Link>
   </div>:<>
    {retry&&<section className={styles.notice}><p>保存結果を確認できていません。</p><button disabled={busy} onClick={()=>void save(retry)}>同じ操作の結果を確認・再試行</button></section>}
    {!state?<p>予約状況を読み込んでいます…</p>:<>
     <section aria-label="面談の申請状況"><h2>{view==='staff'?'確認用の申請一覧':'あなたの面談予約'}</h2><p className={styles.hint}>承認状況は自動で更新されます。</p>
      {state.requests.length===0&&<p>まだ申請はありません。</p>}
      {[...state.requests].reverse().map(row=><article className={styles.panel} key={row.id} aria-label={`${row.studentName}の面談`}>
       <p className={styles.status}>{names[row.status]}{view==='staff'?` ／ ${row.studentName}`:''}</p>
       {row.confirmed&&<p className={row.status==='cancelled'?styles.hint:styles.confirmed}>{row.status==='cancelled'?'取消前の日時：':['change_requested','cancel_requested'].includes(row.status)?'現在の予約：':'確定した日時：'}{describe(row.confirmed)}</p>}
       {['change_requested','cancel_requested'].includes(row.status)&&<p>職員が承認するまで、現在の予約は確保されています。</p>}
       <p>{(row.proposed?.details??row.details).purpose} ／ {(row.proposed?.details??row.details).method} ／ {(row.proposed?.details??row.details).participants}</p>
       <ul>{(row.proposed?.choices??row.choices).map((s,i)=><li key={s.id}>第{i+1}希望：{describe(s)}</li>)}</ul>
       {(row.proposed?.details??row.details).note&&<p>{(row.proposed?.details??row.details).note}</p>}{row.reason&&<p>連絡事項：{row.reason}</p>}
       {view==='student'?<>
        {row.status==='approved'&&<button disabled={busy||!!retry} onClick={()=>{setEditing(row);setCampus(row.confirmed!.campus);setDetails({...row.details});setChoices(['','','']);document.getElementById('interview-request-form')?.scrollIntoView({behavior:'smooth'});}}>日時の変更を申請</button>}
        {['pending','approved'].includes(row.status)&&<><label>取消理由<input maxLength={500} value={reasons[row.id]??''} onChange={e=>setReasons({...reasons,[row.id]:e.target.value})}/></label><button disabled={busy||!!retry||!reasons[row.id]?.trim()} onClick={()=>propose('cancel',row,{reason:reasons[row.id]})}>{row.status==='pending'?'申請を取り消す':'予約の取消を申請'}</button></>}
        {['change_requested','cancel_requested'].includes(row.status)&&<button disabled={busy||!!retry} onClick={()=>propose('withdraw',row)}>変更・取消申請を撤回する</button>}
       </>:<>
        {['pending','change_requested'].includes(row.status)&&<><label>確定する希望日時<select value={selections[row.id]??(row.proposed?.choices??row.choices)[0].id} onChange={e=>setSelections({...selections,[row.id]:e.target.value})}>{(row.proposed?.choices??row.choices).map((s,i)=><option value={s.id} key={s.id}>第{i+1}希望：{describe(s)}</option>)}</select></label><button disabled={busy||!!retry} onClick={()=>propose('approve',row,{slotId:selections[row.id]??(row.proposed?.choices??row.choices)[0].id})}>承認して確定</button></>}
        {['pending','change_requested','cancel_requested'].includes(row.status)&&<><label>対応理由<input maxLength={500} value={reasons[row.id]??''} onChange={e=>setReasons({...reasons,[row.id]:e.target.value})}/></label><div className={styles.actions}>
         {row.status==='cancel_requested'&&<button disabled={busy||!!retry} onClick={()=>propose('approve_cancel',row,{reason:reasons[row.id]||'本人からの取消申請を承認'})}>取消を承認</button>}
         <button disabled={busy||!!retry||!reasons[row.id]?.trim()} onClick={()=>propose(row.status==='cancel_requested'?'reject_cancel':'reject',row,{reason:reasons[row.id]})}>申請を見送る</button>
        </div></>}
       </>}
      </article>)}
     </section>
     {view==='student'&&<form id="interview-request-form" className={styles.panel} onSubmit={submit}>
      <fieldset disabled={busy||!!retry} style={{border:0,padding:0,margin:0,minWidth:0}}><h2>{editing?'希望日時の変更':'面談を申し込む'}</h2><p>担当は担任です。面談は45分、希望日時は最大3件選べます。Webからの申請は面談日の2日前までです。</p>
      <p className={styles.hint}>表示日時は操作確認用の架空の枠です。実際の講師の空き時間ではありません。</p>
      <label>校舎<select value={campus} onChange={e=>{setCampus(e.target.value);setChoices(['','','']);}}><option>本校</option><option>南教室</option></select></label>
      <div className={styles.ranks}>{[0,1,2].map(i=><div key={i} className={styles.rank}><strong>第{i+1}希望{i===0?'（必須）':'（任意）'}</strong>
       <label>第{i+1}希望の日付<input type="date" min={trialDay(2)} max={trialDay(30)} value={dates[i]} onChange={e=>{setDates(dates.map((d,j)=>j===i?e.target.value:d));setChoices(choices.map((s,j)=>j===i?'':s));}}/></label>
       <label>第{i+1}希望の時間<select required={i===0} value={choices[i]} onChange={e=>setChoices(choices.map((s,j)=>j===i?e.target.value:s))}><option value="">選択してください</option>{state.slots.filter(s=>s.date===dates[i]&&s.campus===campus).map(s=><option key={s.id} value={s.id} disabled={!s.available||choices.some((v,j)=>j!==i&&v===s.id)}>{s.start}〜{s.end}{s.available?'':' 予約済み'}</option>)}</select></label>
      </div>)}</div>
      <label>面談方法<select value={details.method} onChange={e=>setDetails({...details,method:e.target.value})}>{['対面','Zoom','電話','ハイブリッド'].map(v=><option key={v}>{v}</option>)}</select></label>
      <label>面談の目的<input required maxLength={500} value={details.purpose} onChange={e=>setDetails({...details,purpose:e.target.value})}/></label>
      <label>参加予定者<input required maxLength={500} value={details.participants} onChange={e=>setDetails({...details,participants:e.target.value})}/></label>
      <label>相談内容・連絡事項<textarea maxLength={1500} value={details.note} onChange={e=>setDetails({...details,note:e.target.value})}/></label>
      <div className={styles.actions}><button disabled={busy||!!retry}>申請内容を確認</button>{editing&&<button type="button" onClick={()=>setEditing(null)}>変更の入力をやめる</button>}</div>
     </fieldset></form>}
    </>}
   </>}
  </>}
  {confirmation&&<FlowDialog label="操作内容の確認" onBack={()=>setConfirmation(null)} blocked={busy||!!retry}>
   <h2>この内容で進めますか</h2><p>{{submit:'面談希望を申請します。職員の承認後に確定します。',change:'日時の変更を申請します。承認までは現在の予約を残します。',cancel:'取消を申請します。確定済みの場合は承認まで予約を残します。',withdraw:'変更・取消申請を撤回します。',approve:'選択した希望日時で確定します。',reject:'この申請を見送ります。',approve_cancel:'取消を承認して予約枠を空けます。',reject_cancel:'取消申請を見送り、元の予約を残します。'}[confirmation.action]}</p>
   {Array.isArray(confirmation.choices)&&<ul>{confirmation.choices.map((id,i)=>{const s=state?.slots.find(v=>v.id===id);return <li key={String(id)}>第{i+1}希望：{s?describe(s):String(id)}</li>;})}</ul>}
   <div className={styles.actions}><button disabled={busy} onClick={()=>void save(confirmation)}>この内容で進める</button></div>
  </FlowDialog>}
 </main>;
}
