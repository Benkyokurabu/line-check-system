'use client';
import {useState} from 'react';
export type BensukeInput={date:string;start:string;end:string;campus:string;room:string;teacher?:string;availabilityRule?:'kinjo';bensuke?:{pageId:string;editedAt:string}};
type Result={date:string;checkedAt:string;rows:{id:string;editedAt:string;title:string;url:string;date:{start:string;end:string|null}|null;fields:{name:string;value:string}[];availability?:({usable:true}&BensukeInput)|{usable:false;reason:string}|null}[]};
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
 {result&&<p>日時・担当者・教室が未設定のカードは自動で重複判定できません。確定前にNotionで内容を確認してください。</p>}
 {result&&<><p>{result.date}の取得結果（{new Date(result.checkedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo'})}時点）</p>{result.rows.length===0?<p>この日に開始する予定はありません。</p>:<ul>{result.rows.map(row=><li key={row.id}><a href={row.url} target="_blank" rel="noopener noreferrer">{row.title||'名前なし'}</a><p>{row.date?`${time(row.date.start)}${row.date.end?`～${time(row.date.end)}`:''}`:'日時未設定'}</p><p>{row.fields.filter(f=>f.value).map(f=>`${f.name}：${f.value}`).join(' ／ ')}</p>{row.availability?.usable&&onUse&&<button type="button" onClick={()=>{if(row.availability?.usable)onUse({...row.availability,bensuke:{pageId:row.id,editedAt:row.editedAt}});}}>この予約可から面談を登録</button>}{row.availability&&!row.availability.usable&&<p>{row.availability.reason}</p>}</li>)}</ul>}<p>この枠から登録すると勉たんで受付済みになり、承認時に同じベンスケのカードへ面談予定を反映します。取消・見送り時は元の予約可へ戻します。</p><p>Notionでの直接編集と同時の操作は避けてください。登録・確定時に既存予定と枠の変更を再確認します。</p><p>表示は開始日がこの日のカードです。前日から続く予定も確定時の重複確認に含めます。</p></>}
 </section>;
}
