'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import StaffEntry from '../self-study-room/staff-entry';
import styles from './workspace.module.css';

type Account={id:string;relation:string;label:string};
type State={student:{name:string;number:string;grade:string};staffName:string;survey:{id:string;url:string;date:string;time?:string;editedAt:string};
 bensuke?:{state:string;id?:string;url?:string};scheduleTeacher?:string;
 historyError?:string;history?:Array<{id:string;line_user_id:string;direction:string;text:string;received_at:string;sent_by?:string}>;answerFields?:Array<{label:string;value:string}>;accounts:Account[];record:{id:string;url:string;body:string;existingText?:string;blockId:string;blockEditedAt:string;editable:boolean}|null};
type Phase='schedule'|'summary';
type Delivery={lineUserId:string;status:'sent'|'already_sent'|'failed'|'history_failed'|'unknown';detail?:string};
const methods=['','電話','LINE','2者Zoom','３者Zoom','２者対面','３者対面','４者Zoom','４者対面','メール','会議','合同手続会'];
const deliveryKey=(phase:Phase,id:string,message:string)=>JSON.stringify([phase,id,message.trim()]);
function relatedNote(account:Account,selected:Account[],studentName:string){
 const others=selected.filter(x=>x.id!==account.id);
 if(!others.length)return '';
 if(others.length>1)return '（ご家族にも同じ文章をお送りしています。）';
 const other=others[0];
 const label=other.relation==='mother'?'お母さま':other.relation==='father'?'お父さま':
  other.relation==='student'?`${studentName.replace(/\s/g,'')}さん`:'ご家族';
 return `（${label}にも同じ文章をお送りしています。）`;
}
function summaryText(body:string,account:Account,selected:Account[],studentName:string,staffName:string){
 return ['本日はありがとうございました。',`今日のお話を簡単にですがまとめさせていただきます。${relatedNote(account,selected,studentName)}`,
  body.trim(),'勉強を進めていく中で何か質問などあったら、遠慮なくLINEで質問してください。保護者の方からも、何かありましたらいつでもお声かけください。',
  `それでは今後ともよろしくお願いいたします。\n${staffName}`].join('\n\n');
}
export default function Workspace({answerId,embedded=false,onSaved}:{answerId:string;embedded?:boolean;onSaved?:()=>void}){
 const [tab,setTab]=useState<'date'|'record'|'summary'>('date');
 const [draftNotice,setDraftNotice]=useState('');
 const [authRequired,setAuthRequired]=useState(false),[code,setCode]=useState(''),[password,setPassword]=useState('');
 const [time,setTime]=useState('');
 const hydrated=useRef(false);
 const draftKey=`bentan:interview-draft:${answerId}`;
 const [data,setData]=useState<State|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[date,setDate]=useState(''),[content,setContent]=useState(''),[method,setMethod]=useState('３者Zoom');
 const [scheduleText,setScheduleText]=useState(''),[selected,setSelected]=useState<Record<Phase,string[]>>({schedule:[],summary:[]});
 const [summaryEdits,setSummaryEdits]=useState<Record<string,string>>({}),[review,setReview]=useState<Phase|null>(null);
 const [deliveries,setDeliveries]=useState<Record<string,Delivery['status']>>({});
 const load=useCallback(async(id:string)=>{
  const response=await fetch(`/api/staff/survey-workflow?answer=${encodeURIComponent(id)}`,{cache:'no-store'});
  const body=await response.json();
  if(!response.ok){if(response.status===401){setAuthRequired(true);setReview(null);}throw Error(body.error||'アンケートと面談情報を取得できません。');}
  setAuthRequired(false);
  const state=body as State;setData(state);
  if(!hydrated.current){
   setDate(state.survey.date||'');setTime(state.survey.time||'');setContent(state.record?.body||'');
   try{const raw=sessionStorage.getItem(draftKey);if(raw){const draft=JSON.parse(raw);
    if(typeof draft.time==='string')setTime(draft.time);if(typeof draft.date==='string')setDate(draft.date);if(typeof draft.content==='string')setContent(draft.content);
    if(draft.summaryEdits&&typeof draft.summaryEdits==='object'&&!Array.isArray(draft.summaryEdits)&&Object.values(draft.summaryEdits).every(value=>typeof value==='string'))setSummaryEdits(draft.summaryEdits);
    if(typeof draft.scheduleText==='string')setScheduleText(draft.scheduleText);if(typeof draft.method==='string')setMethod(draft.method);
    setDraftNotice('このタブの入力途中の内容を復元しました。Notionへの保存は各保存ボタンで行ってください。');
   }}catch{}
   hydrated.current=true;
  }
  return state;
 },[draftKey]);
 useEffect(()=>{const timer=setTimeout(()=>{if(!answerId){setError('アンケート一覧から回答を選んでください。');return;}
  void load(answerId).catch(e=>setError(e instanceof Error?e.message:'取得できませんでした。'));},0);
  return ()=>clearTimeout(timer);
 },[answerId,load]);
 useEffect(()=>{if(!data||!hydrated.current)return;
  try{sessionStorage.setItem(draftKey,JSON.stringify({date,time,content,scheduleText,method,summaryEdits}));}catch{}
 },[data,draftKey,date,time,content,scheduleText,method,summaryEdits]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(data&&(date!==data.survey.date||time!==(data.survey.time??'')||content.trim()!==(data.record?.body??'').trim()))event.preventDefault();};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[data,date,time,content]);
 async function action(payload:Record<string,unknown>){
  setBusy(true);setError('');setNotice('');
  try{const response=await fetch('/api/staff/survey-workflow',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({answerId,expectedSurveyEditedAt:data?.survey.editedAt,...payload})});const body=await response.json();
   if(!response.ok){if(response.status===401){setAuthRequired(true);setReview(null);}throw Error(body.error||'保存できませんでした。');}return body;
  }finally{setBusy(false);}
 }
 async function login(event:FormEvent){
  event.preventDefault();setBusy(true);setError('');
  const secret=password;setPassword('');
  try{
   const response=await fetch('/api/staff/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({staffCode:code,password:secret})});
   const body=await response.json();if(!response.ok)throw Error(body.error||'ログインできませんでした。');
   await load(answerId);setNotice('ログインしました。入力内容を確認してから、保存・送信してください。');
  }catch(e){setError(e instanceof Error?e.message:'ログインできませんでした。');}finally{setBusy(false);}
 }
 async function saveDate(){if(!data)return;try{
  const result=await action({action:'date',date,time,expectedEditedAt:data.survey.editedAt});
  setNotice('面談日をアンケートとベンスケに保存しました。');onSaved?.();
  if(result.bensuke)setData(old=>old?{...old,bensuke:result.bensuke}:old);
  try{const updated=await load(answerId);if(!recordChanged)setContent(updated.record?.body||'');}
  catch{setError('面談日は保存済みです。最新表示を取得できませんでした。「最新情報を読み直す」で確認してください。');}
 }catch(e){setError(e instanceof Error?e.message:'保存できませんでした。');}}
 async function saveRecord(){if(!data)return;try{
  await action({action:'record',content,method,expectedBlockId:data.record?.blockId??'',expectedBlockEditedAt:data.record?.blockEditedAt??''});
  await load(answerId);onSaved?.();setNotice('面談内容をNotionの面談記録に保存しました。');
 }catch(e){setError(e instanceof Error?e.message:'保存できませんでした。');}}
 function toggle(phase:Phase,id:string){
  setSelected(old=>({...old,[phase]:old[phase].includes(id)?old[phase].filter(x=>x!==id):[...old[phase],id]}));
  setReview(null);
 }
 const recipient=(phase:Phase)=>data?.accounts.filter(x=>selected[phase].includes(x.id))??[];
 function messages(phase:Phase){
  if(!data)return [];
  const accounts=recipient(phase);
  return accounts.map(account=>({account,text:phase==='schedule'?scheduleText.trim():
   summaryEdits[account.id]??summaryText(content,account,accounts,data.student.name,data.staffName)}));
 }
 function pendingMessages(phase:Phase){return messages(phase).filter(x=>!['sent','already_sent','history_failed','unknown'].includes(deliveries[deliveryKey(phase,x.account.id,x.text)]??''));}
 async function send(phase:Phase){if(!data)return;const pending=pendingMessages(phase);if(!pending.length)return;
  try{const response=await action({action:'send',phase,messages:pending.map(({account,text})=>({lineUserId:account.id,text}))});
   const results=response.results as Delivery[];
   setDeliveries(old=>({...old,...Object.fromEntries(results.map(x=>[deliveryKey(phase,x.lineUserId,pending.find(p=>p.account.id===x.lineUserId)?.text??''),x.status]))}));
   const uncertain=results.some(x=>x.status==='unknown'||x.status==='history_failed');
   const failed=results.some(x=>x.status==='failed');
   setNotice(uncertain?'送信結果または履歴を確認できない宛先があります。再送せずLINEの履歴を確認してください。':
    failed?'送信できなかった宛先があります。文面とLINEの接続を確認してください。':'選択した宛先へのLINE送信を受け付けました。');
   setReview(null);
  }catch(e){setError(e instanceof Error?e.message:'送信結果を確認できません。再送せずLINEの履歴を確認してください。');}}
 const scheduleChanged=!!data&&(date!==data.survey.date||time!==(data.survey.time??''));
 const recordChanged=!!data&&content.trim()!==(data.record?.body??'').trim();
 const readySummary=!!data?.record?.id&&!recordChanged&&!scheduleChanged;
 return <section className={`${styles.main} ${embedded?styles.embedded:''}`} aria-label="面談入力">
  <header>{!embedded&&<Link href="/">← 勉たんのアンケート一覧に戻る</Link>}{embedded?<h2>アンケートから面談を進める</h2>:<h1>アンケートから面談を進める</h1>}
   <p>面談日・日程連絡・面談記録・面談後のLINEを、同じ生徒の回答から確認します。</p></header>
  {error&&<p className={styles.error} role="alert">{error} {!authRequired&&<button disabled={busy} onClick={()=>void load(answerId).then(()=>setError('')).catch(e=>setError(e.message))}>最新情報を読み直す（入力保持）</button>}</p>}
  {authRequired&&<form className={`${styles.card} ${styles.login}`} onSubmit={login} aria-label="面談の職員ログイン">
   <h2>この画面でログインし直す</h2><p>選んだアンケートと入力途中の内容を保持して、面談を再開します。</p>
   <StaffEntry code={code} onChange={value=>{setCode(value);setPassword('');}} disabled={busy}/>
   {code&&<><label>パスワード<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required disabled={busy}/></label><button disabled={busy||!password}>{busy?'ログイン中…':'ログインして面談を再開'}</button></>}
  </form>}
  {draftNotice&&<p className={styles.notice} role="status">{draftNotice}</p>}
  {notice&&<p className={styles.notice} role="status">{notice}</p>}
  {!data&&!error&&<p>読み込み中…</p>}
  {data&&!authRequired&&<><section className={styles.identity}><strong>{data.student.name}　{data.student.grade}</strong><span>学籍番号 {data.student.number}</span>
   <a href={data.survey.url} target="_blank" rel="noreferrer">アンケート原本 ↗</a></section>
   <details className={styles.answers} open><summary>アンケートの回答を確認</summary><dl>{data.answerFields?.map((field,index)=><div key={index}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></details>
   {embedded&&<div className={styles.tabs} role="group" aria-label="面談の入力項目">{([['date','日程・LINE返信'],['record','面談記録'],['summary','面談後のLINE']] as const).map(([value,label])=><button key={value} aria-pressed={tab===value} onClick={()=>{setTab(value);setReview(null);}}>{label}</button>)}</div>}
   <section hidden={embedded&&tab!=='date'} className={styles.card}><h2>1　面談日を決める</h2><p>日程が決まったら、アンケートの「面談日」とベンスケに保存します。時刻を空欄にすると日付だけで登録します。</p>
    <p>ベンスケの担当者：{data.scheduleTeacher&&data.scheduleTeacher!=='未設定'?`${data.scheduleTeacher}先生`:'未設定（ベンスケで設定できます）'}</p>
    {data.bensuke?.url&&<a href={data.bensuke.url} target="_blank" rel="noreferrer">ベンスケの面談予定 ↗</a>}
    <div className={styles.row}><label>面談日<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
     <label>開始時刻（任意）<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label>
     <button disabled={busy||!date||(!scheduleChanged&&data.bensuke?.state==='synced'&&!error)} onClick={()=>void saveDate()}>{busy?'保存中…':'面談日を保存'}</button></div></section>
   <section hidden={embedded&&tab!=='date'} className={styles.card}><h2>2　日程をLINEで連絡する</h2>
    <p>日程の調整中も返信できます。宛先を選び、文面を確認してから送信します。</p>
    <details className={styles.answers}><summary>最近のLINEのやり取り</summary><p>確認済みの家族アカウントの直近20件です。兄弟の連絡を含む場合があります。</p>{data.historyError&&<p role="alert">{data.historyError}</p>}{data.history?.length?data.history.map(item=><div className={styles.history} key={item.id}><strong>{data.accounts.find(account=>account.id===item.line_user_id)?.label}・{item.direction==='inbound'?'受信':'送信'}</strong><small>{new Date(item.received_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</small><p>{item.text||'文字以外のメッセージ'}</p></div>):<p>表示できるLINE履歴がありません。</p>}</details>
    <RecipientChoices accounts={data.accounts} values={selected.schedule} statusFor={account=>deliveries[deliveryKey('schedule',account.id,scheduleText)]} disabled={busy} onToggle={id=>toggle('schedule',id)}/>
    <label className={styles.blockLabel}>日程連絡の文面<textarea value={scheduleText} onChange={e=>{setScheduleText(e.target.value);setReview(null);}} placeholder="例：面談は10月1日（木）18時から、Zoomでお願いいたします。" rows={5}/></label>
    <div className={styles.actions}><button disabled={!date||busy} onClick={()=>{setScheduleText(`${data.student.name}さんの面談は${date}${time?` ${time}から`:""}にお願いいたします。\n\n${data.staffName}`);setReview(null);}}>日程から文面を作る</button><button disabled={busy||scheduleChanged||!scheduleText.trim()||!pendingMessages('schedule').length} onClick={()=>setReview('schedule')}>宛先・文面を確認</button></div>
    {review==='schedule'&&<SendReview phase="schedule" entries={pendingMessages('schedule')} disabled={busy} onSend={()=>void send('schedule')} onCancel={()=>setReview(null)}/>}
   </section>
   <section hidden={embedded&&tab!=='record'} className={styles.card}><h2>3　面談後の内容を記録する</h2>
    <p>下の本文だけをNotionの面談記録に保存します。挨拶と結びはLINE文面を作るときに加えます。</p>
    {data.record?.url&&<a href={data.record.url} target="_blank" rel="noreferrer">面談記録の原本 ↗</a>}
    {data.record?.body&&recordChanged&&<details className={styles.answers}><summary>保存済みの面談記録と比べる</summary><p className={styles.recordOriginal}>{data.record.body}</p></details>}
    {data.record?.existingText&&<details className={styles.answers} open><summary>既存の面談記録（保存済み）</summary><p className={styles.recordOriginal}>{data.record.existingText}</p><p>下の入力欄は追記として保存します。既存の文章を残したまま入力できます。</p></details>}
    {data.record&&!data.record.editable?<p className={styles.error}>記録が大きいか編集用ブロックが重複しています。原本の確認が必要です。</p>:<>
     <label className={styles.blockLabel}>面談内容<textarea aria-label="面談内容" value={content} onChange={e=>{setContent(e.target.value);setSummaryEdits({});setReview(null);}} rows={15} placeholder="志望校について&#10;…"/></label>
     {!data.record?.id&&<label>面談方法<select value={method} onChange={e=>setMethod(e.target.value)}>{methods.map(x=><option key={x} value={x}>{x||'未設定'}</option>)}</select></label>}
     <div className={styles.actions}><button disabled={busy||!date||scheduleChanged||!content.trim()||!recordChanged} onClick={()=>void saveRecord()}>{data.record?.id?'面談記録を更新':'面談記録を作成'}</button></div>
    </>}
    {scheduleChanged&&<p role="status">面談日が未保存です。「日程・LINE返信」で日程を保存してください。入力した記録は保持されます。</p>}
   </section>
   <section hidden={embedded&&tab!=='summary'} className={styles.card}><h2>4　面談後のまとめをLINEで送る</h2>
    <p>本人・母・父などから宛先を選べます。相手ごとの文面を確認・修正してから送信します。</p>
    <RecipientChoices accounts={data.accounts} values={selected.summary} statusFor={account=>deliveries[deliveryKey('summary',account.id,
     summaryEdits[account.id]??summaryText(content,account,recipient('summary'),data.student.name,data.staffName))]} disabled={busy} onToggle={id=>toggle('summary',id)}/>
    {messages('summary').map(({account,text})=><label className={styles.blockLabel} key={account.id}>{account.label}への文面
     <textarea value={text} onChange={e=>{setSummaryEdits(old=>({...old,[account.id]:e.target.value}));setReview(null);}} rows={14}/></label>)}
    <div className={styles.actions}><button disabled={busy||!readySummary||!pendingMessages('summary').length||messages('summary').some(x=>!x.text.trim())} onClick={()=>setReview('summary')}>宛先・文面を確認</button></div>
    {!readySummary&&<p>面談記録を保存すると送信できます。</p>}
    {review==='summary'&&<SendReview phase="summary" entries={pendingMessages('summary')} disabled={busy} onSend={()=>void send('summary')} onCancel={()=>setReview(null)}/>}
   </section>
  </>}
 </section>;
}
function RecipientChoices({accounts,values,statusFor,disabled,onToggle}:{accounts:Account[];values:string[];
 statusFor:(account:Account)=>Delivery['status']|undefined;disabled:boolean;onToggle:(id:string)=>void}){
 if(!accounts.length)return <p className={styles.error}>確認済みのLINE宛先がありません。生徒とLINEアカウントの照合を確認してください。</p>;
 return <fieldset className={styles.recipients}><legend>送信先をチェック</legend>{accounts.map(account=>{
  const status=statusFor(account);
  return <label key={account.id}><input type="checkbox" checked={values.includes(account.id)} disabled={disabled}
   onChange={()=>onToggle(account.id)}/><span>{account.label}</span>{status&&<small>{({sent:'送信済み',already_sent:'送信済み',failed:'送信失敗',history_failed:'送信済み・履歴要確認',unknown:'結果要確認'} as Record<string,string>)[status]}</small>}</label>;
 })}</fieldset>;
}
function SendReview({phase,entries,disabled,onSend,onCancel}:{phase:Phase;entries:Array<{account:Account;text:string}>;disabled:boolean;onSend:()=>void;onCancel:()=>void}){
 return <div className={styles.review}><h3>{phase==='schedule'?'日程連絡':'面談後のまとめ'}の送信確認</h3>
  {entries.map(({account,text})=><div key={account.id}><strong>{account.label}</strong><pre>{text}</pre></div>)}
  <div className={styles.actions}><button className={styles.send} disabled={disabled} onClick={onSend}>表示した宛先へLINE送信</button><button disabled={disabled} onClick={onCancel}>戻って修正</button></div>
 </div>;
}
