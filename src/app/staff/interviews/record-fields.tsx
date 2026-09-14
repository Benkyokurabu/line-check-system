'use client';
import {makeRecordDraft,recordTextFields} from '@/lib/interview-record.mjs';
import styles from './workspace.module.css';
export type RecordDraft=ReturnType<typeof makeRecordDraft>;
export function RecordFields({value,onChange}:{value:RecordDraft;onChange:(value:RecordDraft)=>void}){
 const change=(key:string,text:string)=>onChange({...value,[key]:text});
 return <>
  <p>予定の日時・参加者を引き継いでいます。実際の内容に合わせて修正してください。</p>
  <div className={styles.filters}>
   <label>実施日<input type="date" value={value.actualDate} onChange={e=>change('actualDate',e.target.value)}/></label>
   <label>実際の開始時刻<input type="time" value={value.actualStart} onChange={e=>change('actualStart',e.target.value)}/></label>
   <label>実際の終了時刻<input type="time" value={value.actualEnd} onChange={e=>change('actualEnd',e.target.value)}/></label>
  </div>
  <label>実際の参加者<input value={value.actualParticipants} maxLength={500} onChange={e=>change('actualParticipants',e.target.value)}/></label>
  <label>記録の面談目的<input value={value.purpose} maxLength={500} onChange={e=>change('purpose',e.target.value)}/></label>
  {recordTextFields.map(([key,label,max])=><label key={String(key)}>{label}<textarea value={String(value[key as keyof RecordDraft]??'')} maxLength={Number(max)} onChange={e=>change(String(key),e.target.value)}/></label>)}
  <label>次回確認日<input type="date" value={value.nextReviewDate} onChange={e=>change('nextReviewDate',e.target.value)}/></label>
 </>;
}
export function RecordDetails({value}:{value:Partial<RecordDraft>}){
 return <>
  {value.actualDate&&<p>実施：{value.actualDate} {value.actualStart}～{value.actualEnd} ／ {value.actualParticipants}</p>}
  {value.purpose&&<p>面談目的：{value.purpose}</p>}
  {recordTextFields.map(([key,label])=>value[key as keyof RecordDraft]?<div key={String(key)}><strong>{label}</strong><p style={{whiteSpace:'pre-wrap'}}>{String(value[key as keyof RecordDraft])}</p></div>:null)}
  {value.nextReviewDate&&<p>次回確認日：{value.nextReviewDate}</p>}
 </>;
}
