'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {enrollmentFields} from '@/lib/enrollment-core.mjs';
import AudioInput from './audio-input';
import styles from './workspace.module.css';
type Staff={staffId:string;staffCode:string;displayName:string;role:string};
type Field={value:string;state:'confirmed'|'review'|'unknown'|'not_applicable';reason:string;source:string;candidates:string[]};
type Payload={studentPageId:string;intakePageId:string;fields:Record<string,Field>;record:string;sourceText:string};
type Entry={id:string;version:number;status:string;payload:Payload;targets:Record<string,{status:string;error?:string;url?:string}>};
type Student={id:string;name:string;number:string;campus?:string;grade?:string;status?:string;url?:string;values?:Record<string,string>};
type Context={entry:Entry|null;payload:Payload;student:Student;intakes:{id:string;title:string;date:string;status:string;snapshot:string;url:string}[];snapshot:string;stableSnapshot:string;actorIssue:string;staffOptions?:{id:string;name:string}[]};
type ListRow={id:string;studentName:string;studentNumber:string;status:string;pending:number;updatedAt:string};
type History={id:string;date:string;title:string;url:string;purpose:string};
type Def={key:string;label:string;type:string;options?:string[];hint?:string};
const defs=enrollmentFields as Def[];
const targetNames:Record<string,string>={interview:'面談記録',student:'生徒情報',intake:'受付・入会チェック表',mtg:'終業ミーティング'};
const statusNames:Record<string,string>={queued:'反映待ち',running:'反映中',partial:'一部反映待ち',review:'人の確認待ち',complete:'反映完了',pending:'反映待ち',synced:'反映済み',retry:'再試行待ち',creating:'登録結果の確認中',updating:'更新結果の確認中'};
export default function EnrollmentWorkspace(){
 const [staff,setStaff]=useState<Staff|null>(null),[ready,setReady]=useState(false),[code,setCode]=useState('KUDO'),[password,setPassword]=useState('');
 const [query,setQuery]=useState(''),[students,setStudents]=useState<Student[]>([]),[entries,setEntries]=useState<ListRow[]>([]);
 const [context,setContext]=useState<Context|null>(null),[payload,setPayload]=useState<Payload|null>(null),[entry,setEntry]=useState<Entry|null>(null),[history,setHistory]=useState<History[]>([]);
 const [busy,setBusy]=useState(false),[audioBusy,setAudioBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[dirty,setDirty]=useState(false),[candidate,setCandidate]=useState('');
 const running=useRef(false),selected=useRef(''),alive=useRef(true),saveKey=useRef<{serialized:string;operationKey:string}|null>(null),caseId=useRef('');
 const draftOwner=useRef('');
 useEffect(()=>{if(staff)draftOwner.current=staff.staffId;},[staff]);
 const allowed=!!staff&&['KUDO','KINJO'].includes(staff.staffCode)&&['admin','office','employee'].includes(staff.role);
 const locked=busy||audioBusy;
 const api=useCallback(async(url:string,options?:RequestInit)=>{const r=await fetch(url,{cache:'no-store',...options});const d=await r.json();if(!r.ok){if(r.status===401){setStaff(null);setEntries([]);setStudents([]);}if(r.status===403){setContext(null);setPayload(null);setEntry(null);setHistory([]);setEntries([]);setStudents([]);}throw Error(d.error||'処理を完了できませんでした。');}return d;},[]);
 const post=(body:unknown)=>api('/api/staff/enrollment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 async function work(action:()=>Promise<void>){if(running.current)return;running.current=true;setBusy(true);setError('');try{await action();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'処理を完了できませんでした。');}finally{running.current=false;if(alive.current)setBusy(false);}}
 const loadList=useCallback(async()=>{const d=await api('/api/staff/enrollment');if(alive.current)setEntries(d.entries);},[api]);
 useEffect(()=>{alive.current=true;fetch('/api/staff/session',{cache:'no-store'}).then(async r=>{if(r.ok){const d=await r.json();if(alive.current)setStaff(d.staff);}}).catch(()=>{}).finally(()=>{if(alive.current)setReady(true);});return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!allowed)return;Promise.resolve().then(()=>loadList()).catch(e=>{if(alive.current)setError(e.message);});},[allowed,loadList]);
 useEffect(()=>{const handler=(event:BeforeUnloadEvent)=>{if(dirty||audioBusy){event.preventDefault();}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty,audioBusy]);
 useEffect(()=>{if(!allowed||dirty||!entry||!['queued','running','partial'].includes(entry.status))return;const id=entry.id;const timer=setInterval(()=>{void api('/api/staff/enrollment?status='+id).then(d=>{if(alive.current)setEntry(current=>current?.id===id&&current.version<=d.entry.version?d.entry:current);}).catch(()=>{});},10000);return()=>clearInterval(timer);},[allowed,dirty,entry,api]);
 async function openContext(url:string,preserve=false){const d:Context=await api(url);if(!alive.current)return;
  setContext(d);selected.current=d.student.id;setEntry(d.entry);if(d.entry?.id)caseId.current=d.entry.id;else if(!preserve||!caseId.current)caseId.current=crypto.randomUUID();
  if(!preserve){setPayload(d.payload);setDirty(false);setCandidate('');saveKey.current=null;}
  try{const h=await api('/api/staff/enrollment?history='+d.student.id);if(alive.current&&selected.current===d.student.id)setHistory(h.history);}catch{setNotice('入力画面は開きました。過去の面談一覧は取得できませんでした。');}
 }
 useEffect(()=>{if(!allowed)return;const id=new URLSearchParams(window.location.search).get('entry');if(id)void work(()=>openContext('/api/staff/enrollment?entry='+encodeURIComponent(id)));
 // Only consume the initial link after authentication.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[allowed]);
 async function login(e:FormEvent){e.preventDefault();await work(async()=>{const d=await api('/api/staff/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({staffCode:code,password})});if(draftOwner.current&&draftOwner.current!==d.staff.staffId){setContext(null);setPayload(null);setEntry(null);setHistory([]);setDirty(false);saveKey.current=null;}setPassword('');setStaff(d.staff);});}
 function editField(key:string,patch:Partial<Field>){setPayload(p=>{if(!p)return p;return {...p,fields:{...p.fields,[key]:{...p.fields[key],...patch}}};});setDirty(true);setNotice('');}
 function field(def:Def){if(!payload)return null;const row=payload.fields[def.key];return <div key={def.key} className={`${styles.field} ${row.state==='review'?styles.review:''}`}>
  <label htmlFor={'field-'+def.key}>{def.label}</label>
  {def.type==='staff'?<select id={'field-'+def.key} value={row.value} disabled={locked} onChange={e=>editField(def.key,{value:e.target.value,state:e.target.value?'confirmed':'unknown',source:'職員入力',reason:''})}><option value="">手続担当者を選んでください</option>{context?.staffOptions?.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>
   :def.type==='check'?<select id={'field-'+def.key} value={row.value} disabled={locked} onChange={e=>editField(def.key,{value:e.target.value,state:e.target.value?'confirmed':'unknown',source:'職員入力',reason:''})}><option value="">未確認</option><option value="済">済</option><option value="未実施">未実施</option></select>
   :def.options?<select id={'field-'+def.key} disabled={locked} value={row.value} onChange={e=>editField(def.key,{value:e.target.value,state:e.target.value?'confirmed':'unknown',source:'職員入力',reason:''})}><option value="">選択してください</option>{row.value&&!def.options.includes(row.value)&&<option value={row.value}>候補：{row.value}</option>}{def.options.map(o=><option key={o}>{o}</option>)}</select>
   :<input id={'field-'+def.key} type={def.type==='date'?'date':'text'} value={row.value} disabled={locked} onChange={e=>editField(def.key,{value:e.target.value,state:e.target.value?'confirmed':'unknown',source:'職員入力',reason:''})}/>}
  <label htmlFor={'state-'+def.key}>判断の状態<select id={'state-'+def.key} value={row.state} disabled={locked} onChange={e=>editField(def.key,{state:e.target.value as Field['state']})}><option value="confirmed">確定</option><option value="review">要確認</option><option value="unknown">未入力・未確認</option><option value="not_applicable">該当なし</option></select></label>
  {def.hint&&<p>{def.hint}</p>}{row.source&&<p>根拠：{row.source}</p>}{row.candidates?.length>0&&<p>候補：{row.candidates.join('／')}</p>}
  {row.state==='review'&&<label>確認すること<input value={row.reason} disabled={locked} onChange={e=>editField(def.key,{reason:e.target.value})}/></label>}
 </div>;}
 async function save(e:FormEvent){e.preventDefault();if(!payload||!context)return;
  await work(async()=>{
   const intake=context.intakes.find(i=>i.id===payload.intakePageId);
   const base={action:'save',id:caseId.current,version:entry?.version??0,payload,snapshot:context.snapshot,stableSnapshot:context.stableSnapshot,intakeSnapshot:intake?.snapshot??''};
   const serialized=JSON.stringify(base);if(saveKey.current?.serialized!==serialized)saveKey.current={serialized,operationKey:crypto.randomUUID()};
   const data=await post({...base,operationKey:saveKey.current.operationKey});setEntry(data.entry);setDirty(false);setNotice('入力を保存しました。各所への反映結果と、人の判断待ちを下で確認できます。');
   await openContext('/api/staff/enrollment?entry='+data.entry.id);await loadList();
  });
 }
 const pending=payload?defs.filter(f=>!['confirmed','not_applicable'].includes(payload.fields[f.key].state)):[];
 return <main className={styles.main}><Link href="/">勉たんへ戻る</Link><h1>入塾手続きの一括入力</h1><p className={styles.summary}><strong>本番運用前</strong>：正式運用済みとしては扱いません。現在の入力・保存機能は引き続き利用できます。</p><p>一つの画面に入力し、面談記録・生徒情報・受付チェック表・終業ミーティングへ反映します。判断できない項目は保留し、人が確定した後に続けて反映します。</p>
 {error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className={styles.notice}>{notice}</p>}
 {!ready?<p>ログイン状態を確認しています…</p>:!staff?<form className={styles.panel} onSubmit={login}><h2>職員ログイン</h2><label>職員コード<input autoComplete="username" value={code} onChange={e=>setCode(e.target.value)} disabled={busy} required/></label><label>パスワード<input autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} required/></label><button type="submit" className={styles.primary} disabled={busy}>ログイン</button></form>:!allowed?<p>この機能は、入塾手続きの入力権限を持つ職員が利用できます。</p>:<>
 <section className={styles.panel}><p>{staff.displayName}さんとして入力しています。</p><h2>生徒を選ぶ</h2>{dirty&&<p className={styles.notice}>編集中の入力があります。保存してから別の生徒・記録を開いてください。</p>}
 <form onSubmit={e=>{e.preventDefault();void work(async()=>{const d=await api('/api/staff/enrollment?q='+encodeURIComponent(query));setStudents(d.students);if(d.hasMore)setNotice('候補が多いため、生徒名を追加して絞り込んでください。');});}}><label>生徒名<input value={query} onChange={e=>setQuery(e.target.value)} disabled={locked} required/></label><button disabled={locked} type="submit">生徒を検索</button></form>
 <div className={styles.cards}>{students.map(s=><button key={s.id} disabled={locked||dirty} onClick={()=>void work(()=>openContext('/api/staff/enrollment?student='+s.id))}>{s.name} ／ {s.grade} ／ {s.campus} ／ {s.number} ／ {s.status}</button>)}</div></section>
 {context&&payload&&<><section className={styles.panel} aria-label="入塾手続きの入力"><h2>{context.student.name}さんの入塾手続き</h2><p>{context.student.number}　{context.student.values?.['所属']}　{context.student.values?.['学年']}</p><p><a href={context.student.url} target="_blank" rel="noreferrer">Notionの生徒情報を確認</a></p>
 {context.actorIssue&&<p className={styles.error}>{context.actorIssue}</p>}
 <form onSubmit={save}><fieldset disabled={busy}>
 <div className={styles.grid}>{defs.filter(f=>['admissionDate','procedureDate','procedureStaff','interviewDate','method','grade','campus','studentStatus','homeroom','studentNumber','intakeStatus'].includes(f.key)).map(field)}</div>
 <p className={styles.muted}>入塾日は手続き日・面談日と分けて入力します。空欄や要確認の項目で、Notionの既存値を消すことはありません。</p>
 <label>対象の受付記録<select value={payload.intakePageId} disabled={locked} onChange={e=>{setPayload({...payload,intakePageId:e.target.value});setDirty(true);}}><option value="">受付の記録を選択してください</option>{context.intakes.map(i=><option key={i.id} value={i.id}>{i.title} ／ {i.status} ／ {i.date}</option>)}</select></label>
 {field(defs.find(f=>f.key==='classes')!)}{field(defs.find(f=>f.key==='intakeNote')!)}
 <details><summary>書類・登録・配布などの実施確認</summary><p>実際に確認できた作業を選択します。チェック表の記入だけで、元のExcelやLINE等を変更したことにはしません。</p><div className={styles.grid}>{defs.filter(f=>f.type==='check').map(field)}</div></details>
 <AudioInput key={context.student.id} onBusy={setAudioBusy} onText={text=>{setPayload(p=>p?{...p,sourceText:[p.sourceText,text].filter(Boolean).join('\n\n')}:p);setDirty(true);}}/>
 <label>面談の内容・補足<textarea value={payload.sourceText} disabled={locked} onChange={e=>{setPayload({...payload,sourceText:e.target.value});setDirty(true);}}/></label>
 <button type="button" disabled={locked||!payload.sourceText.trim()} onClick={()=>void work(async()=>{const d=await post({action:'draft',sourceText:payload.sourceText});setCandidate(d.record);setPayload(p=>{if(!p)return p;const fields={...p.fields};for(const [key,row]of Object.entries(d.fields as Record<string,Field>))if(fields[key]&&fields[key].state!=='confirmed'&&fields[key].source!=='職員入力')fields[key]=row;return {...p,fields};});setDirty(true);})}>AIで記録と入力候補を作る</button>
 {candidate&&<section className={styles.notice}><h3>AIが作成した記録の候補</h3><p style={{whiteSpace:'pre-wrap'}}>{candidate}</p><button type="button" disabled={locked} onClick={()=>{setPayload({...payload,record:candidate});setCandidate('');setDirty(true);}}>この文章を記録に使用する</button><p>項目の候補は「要確認」で表示します。元の発言を見て確定してください。</p></section>}
 <label>詳しい記録（面談DBと生徒概要へ保存）<textarea value={payload.record} disabled={locked} maxLength={16000} onChange={e=>{setPayload({...payload,record:e.target.value});setDirty(true);}}/></label>
 <div className={styles.summary}><strong>終業ミーティングの「内容」の既定</strong><p>［この入塾手続きの記録へのリンク］ 詳細はこちら</p><p className={styles.muted}>個別の補足やAIの要約は自動追加しません。</p></div>
 <h3>人の判断待ち {pending.length}件</h3>{pending.length>0?<ul>{pending.map(f=><li key={f.key}>{f.label}：{payload.fields[f.key].reason||'未入力・未確認'}</li>)}</ul>:<p>すべての項目が確定または該当なしです。</p>}
 <div className={styles.actions}><button type="submit" className={styles.primary} disabled={locked}>{busy?'保存・反映中…':'保存して各所へ反映'}</button><button type="button" disabled={locked} onClick={()=>void work(async()=>{await openContext(entry?'/api/staff/enrollment?entry='+entry.id:'/api/staff/enrollment?student='+context.student.id,true);setNotice('入力は保持しています。表示したNotionの現在値と比較し、必要な箇所を直してから保存してください。');})}>入力を保持して最新情報を確認</button></div>
 </fieldset></form></section>
 {entry&&<section className={styles.panel} aria-label="各所への反映結果"><h2>保存結果：{statusNames[entry.status]??entry.status}</h2><p>入力記録を保存済みです。判断待ちと、反映が終わっていない先を確認してください。</p><ul className={styles.status}>{Object.entries(entry.targets).map(([key,s])=><li key={key}><strong>{targetNames[key]}</strong><span>{statusNames[s.status]??s.status}</span>{s.error&&<p>{s.error}</p>}{s.url&&<a href={s.url} target="_blank" rel="noreferrer">反映先を確認</a>}</li>)}</ul><button disabled={locked||dirty} onClick={()=>void work(async()=>{await post({action:'retry',id:entry.id});await openContext('/api/staff/enrollment?entry='+entry.id);await loadList();})}>反映を再確認</button></section>}
 <section className={`${styles.panel} ${styles.overview}`} aria-label="生徒概要と経緯"><h2>{context.student.name}さんの生徒概要と経緯</h2><div className={styles.summary}>{Object.entries(context.student.values??{}).map(([label,value])=><p key={label}><strong>{label==='本当の入塾日'?'入塾日':label}</strong>：{value||'未入力'}</p>)}</div>{entry?.payload.record&&<p style={{whiteSpace:'pre-wrap'}}>{entry.payload.record}</p>}<ol className={styles.history}>{history.map(h=><li key={h.id}>{h.date||'日付未入力'}　<a href={h.url} target="_blank" rel="noreferrer">{h.title||h.purpose||'面談記録'}</a></li>)}</ol><button type="button" onClick={()=>window.print()}>概要と記録を印刷</button></section></>}
 <section className={styles.panel}><h2>保存済みの入塾手続き</h2><div className={styles.cards}>{entries.map(r=><button key={r.id} disabled={locked||dirty} onClick={()=>void work(()=>openContext('/api/staff/enrollment?entry='+r.id))}>{r.studentName} ／ {r.studentNumber}<br/>{statusNames[r.status]??r.status}　判断待ち{r.pending}件</button>)}</div>{entries.length===0&&<p>保存した入力記録はありません。</p>}</section>
 </>}
 </main>;
}
