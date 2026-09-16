'use client';
import {useState} from 'react';
export type BensukeInput={date:string;start:string;end:string;campus:string;room:string};
type Result={date:string;checkedAt:string;rows:{id:string;title:string;url:string;date:{start:string;end:string|null}|null;fields:{name:string;value:string}[];availability?:({usable:true}&BensukeInput)|{usable:false;reason:string}|null}[]};
const time=(value:string)=>value.includes('T')?new Date(value).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}):'終日';
export default function BensukePanel({date,onUse}:{date:string;onUse?:(input:BensukeInput)=>void}){
 const [result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function read(){
  setBusy(true);setResult(null);setError('');
  try{const response=await fetch(`/api/staff/interviews/bensuke?date=${encodeURIComponent(date)}`,{cache:'no-store'});const body=await response.json();if(!response.ok)throw Error(body.error??'予定を取得できませんでした。');setResult(body);}
  catch(e){setError(e instanceof Error?e.message:'予定を取得できませんでした。');}finally{setBusy(false);}
 }
 return <section className="panel"><h2>ベンスケの予定</h2><p>{date}の予定をNotionから確認できます。面談以外の予定も表示します。</p><button type="button" disabled={busy} onClick={()=>void read()}>{busy?'読み込み中…':'ベンスケから予定を取得'}</button>
 {error&&<p role="alert">{error}</p>}
 {result&&<><p>{result.date}の取得結果（{new Date(result.checkedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo'})}時点）</p>{result.rows.length===0?<p>この日に開始する予定はありません。</p>:<ul>{result.rows.map(row=><li key={row.id}><a href={row.url} target="_blank" rel="noopener noreferrer">{row.title||'名前なし'}</a><p>{row.date?`${time(row.date.start)}${row.date.end?`～${time(row.date.end)}`:''}`:'日時未設定'}</p><p>{row.fields.filter(f=>f.value).map(f=>`${f.name}：${f.value}`).join(' ／ ')}</p>{row.availability?.usable&&onUse&&<button type="button" onClick={()=>{if(row.availability?.usable)onUse(row.availability);}}>日時・校舎・教室を面談入力に使う</button>}{row.availability&&!row.availability.usable&&<p>{row.availability.reason}</p>}</li>)}</ul>}<p>日時の転記は入力補助です。担当講師の対応可否を確認してください。ベンスケの枠確保・予約確定はまだ連動しません。</p><p>表示は開始日がこの日のカードです。前日から続く予定や日時未設定のカードはNotionでも確認してください。</p></>}
 </section>;
}
