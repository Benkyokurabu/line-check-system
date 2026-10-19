'use client';
import {useEffect,useState} from 'react';
import styles from './workspace.module.css';
export type ParentWorkLog={enabled:boolean;teacher:string;task:string;start:string;end:string;contact:string;content:string;result:string};
type Options={month:string;file:{name:string;url:string};teachers:string[];tasks:string[];contents:string[];results:string[]};
const empty:ParentWorkLog={enabled:true,teacher:'',task:'',start:'',end:'',contact:'',content:'',result:''};
export default function ParentWorkLogInput({value,date,disabled,onChange,onSave,canSave,allowDisable=true,optionsEndpoint='/api/staff/post-interview?worklogMonth=',saveLabel='保存して面談・業務記録へ反映'}:{value?:ParentWorkLog;date:string;disabled:boolean;onChange:(value:ParentWorkLog)=>void;onSave:()=>void;canSave:boolean;allowDisable?:boolean;optionsEndpoint?:string;saveLabel?:string}){
 const form=value??empty,month=/^20\d{2}-\d{2}-\d{2}$/.test(date)?date.slice(0,7):'';
 const [options,setOptions]=useState<Options|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{if(!month||!form.enabled)return;const controller=new AbortController();
  async function load(){setLoading(true);setError('');setOptions(null);try{const response=await fetch(optionsEndpoint+month,{cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'業務記録簿を確認できませんでした。');if(!['teachers','tasks','contents','results'].every(k=>Array.isArray(data[k])))throw Error('業務記録簿の選択肢を確認できませんでした。');if(!controller.signal.aborted)setOptions(data);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'業務記録簿を確認できませんでした。');}finally{if(!controller.signal.aborted)setLoading(false);}}
  void load();return()=>controller.abort();
 },[month,form.enabled,attempt,optionsEndpoint]);
 const edit=(key:keyof ParentWorkLog,next:string|boolean)=>onChange({...form,[key]:next});
 const select=(key:'teacher'|'task'|'content'|'result',label:string,list?:string[])=><label key={key}>{label}<select disabled={disabled||loading||!options} value={form[key]} onChange={e=>edit(key,e.target.value)}><option value="">選択してください</option>{form[key]&&!list?.includes(form[key])&&<option value={form[key]}>{form[key]}（原本の選択肢を確認）</option>}{list?.map(item=><option key={item}>{item}</option>)}</select></label>;
 const start=Number(form.start.slice(0,2))*60+Number(form.start.slice(3)),end=Number(form.end.slice(0,2))*60+Number(form.end.slice(3));
 return <section className={styles.card}><h2>担任業務記録（対保護者）</h2>{allowDisable&&<label><input type="checkbox" disabled={disabled} checked={form.enabled} onChange={e=>edit('enabled',e.target.checked)}/>この面談をOneDriveの「担任業務記録簿 対保護者」に記入する</label>}
 {form.enabled&&<><p>実施日の月の記録簿へ、下の内容を「{saveLabel}」で記入します。実際の開始・終了時刻を入力してください。時間は自動計算します。</p>
 {!month&&<p role="status">上の実施日を入力すると、該当月の記録簿と選択肢を読み込みます。</p>}{loading&&<p role="status">OneDriveの記録簿を確認しています…</p>}{error&&<p role="alert" className={styles.error}>{error} <button type="button" disabled={disabled} onClick={()=>setAttempt(a=>a+1)}>業務記録簿を再読み込み</button></p>}
 {options?.file&&<p>記入先：<a href={options.file.url} target="_blank" rel="noreferrer">{options.file.name}</a></p>}
 <div className={styles.fields}>{select('teacher','業務記録の氏名',options?.teachers)}{select('task','業務記録の摘要',options?.tasks)}<label>業務記録の開始時刻<input type="time" disabled={disabled} value={form.start} onChange={e=>edit('start',e.target.value)}/></label><label>業務記録の終了時刻<input type="time" disabled={disabled} value={form.end} onChange={e=>edit('end',e.target.value)}/></label><label>業務記録の生徒名・相手<input disabled={disabled} value={form.contact} maxLength={500} onChange={e=>edit('contact',e.target.value)}/></label>{select('content','業務記録の内容',options?.contents)}{select('result','業務記録の結果',options?.results)}</div>
 {form.start&&form.end&&<p role="status">{end>start?`記録する時間：${Math.floor((end-start)/60)}時間${(end-start)%60}分`:'終了時刻は開始時刻より後にしてください。'}</p>}<p className={styles.small}>{allowDisable?'未入力の項目がある場合は業務記録だけを保留し、入力済みの面談記録・アンケートは保存します。':'未入力の項目がある場合は入力を保存し、OneDriveへの記入を保留します。'}実際の時刻と結果を確認してご入力ください。</p></>}
 <div className={styles.actions}><button type="button" className={styles.primary} disabled={disabled||!canSave} onClick={onSave}>{saveLabel}</button></div></section>;
}
