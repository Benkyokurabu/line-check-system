"use client";
import { useState } from "react";
import { getJapanDate, isValidReservationDate } from "@/lib/reservation-date.mjs";
import styles from "./staff-study-room.module.css";

type Student = { student_number:string; student_name:string; grade:string; campus:string|null };
type Options = { students:Student[]; hasMore:boolean; student:Student|null; date:string;
  booked:{seat:number;slotId:string}[]; closedSlotIds:string[]; limitMinutes:number; studentMinutes:number; pendingSlotIds:string[]; studentSlotIds:string[] };
type Intake = { operationKey:string; studentNumber:string; date:string; seat:number; slotIds:string[]; contactChannel:string; note:string };
type Props = { busy:boolean; request:(url:string,init?:RequestInit)=>Promise<unknown>;
  work:(task:()=>Promise<void>)=>Promise<void>; onPending:(pending:boolean)=>void; onDone:(date:string)=>Promise<void> };
const slots = ['14:55-16:25','16:45-18:15','18:35-20:05','20:25-21:55'];

export default function StaffIntake({busy,request,work,onPending,onDone}:Props) {
  const [query,setQuery] = useState(''); const [date,setDate] = useState(getJapanDate());
  const [options,setOptions] = useState<Options|null>(null); const [student,setStudent] = useState<Student|null>(null);
  const [seat,setSeat] = useState(1); const [selectedSlots,setSlots] = useState<string[]>([]);
  const [channel,setChannel] = useState('line_message'); const [note,setNote] = useState('');
  const [confirm,setConfirm] = useState(false); const [pending,setPending] = useState<Intake|null>(null);
  const [notice,setNotice] = useState('');
  const frozen = busy || !!pending;
  const validDate=isValidReservationDate(date) && date>=getJapanDate();
  const valid=validDate && options?.student?.student_number===student?.student_number && options?.date===date
    && selectedSlots.length>0 && !!note.trim()
    && (!options.limitMinutes || options.studentMinutes+selectedSlots.length*90<=options.limitMinutes);
  async function load(chosen:Student|null = student) {
    setOptions(null); setSlots([]); setConfirm(false);
    const params = new URLSearchParams({date,query});
    if (chosen) params.set('student',chosen.student_number);
    const result = await request(`/api/staff/study-room/intake-options?${params}`) as Options;
    setOptions(result); setStudent(result.student);
  }
  async function submit(value:Intake) {
    await work(async () => {
      setPending(value); onPending(true); setNotice('');
      try {
        await request('/api/staff/study-room/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
      } catch(error) {
        const status = (error as {status?:number}).status;
        if (status && status<500) {
          setPending(null); onPending(false); setConfirm(false); setOptions(null); setSlots([]);
          throw error;
        }
        setNotice('結果を確認できません。「同じ申請の結果を再確認」を押してください。内容を変えて再登録しないでください。');
        return;
      }
      setPending(null); onPending(false); setConfirm(false); setOptions(null); setSlots([]); setNote('');
      setNotice('承認待ちとして受け付けました。座席はまだ確定していません。申請一覧で内容を確認して承認してください。');
      await onDone(value.date);
    });
  }
  return <section className={styles.card} aria-label="職員代理受付"><h2>職員による代理申請</h2>
    <p>利用施設は本校自習室です。南教室の例外利用もこちらで受け付けます。連絡内容と利用生徒を確認してください。</p>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <div className={styles.toolbar}>
      <label className={styles.field}>生徒名・学籍番号<input value={query} maxLength={64} disabled={frozen} onChange={e=>{setQuery(e.target.value);setOptions(null);setStudent(null);setSlots([]);setConfirm(false);}} /></label>
      <button type="button" disabled={frozen || !query.trim() || !validDate} onClick={()=>work(async()=>{setNotice('');await load(null);})}>生徒を検索</button>
      <label className={styles.field}>代理申請の利用日<input type="date" min={getJapanDate()} value={date} disabled={frozen} onChange={e=>{setDate(e.target.value);setOptions(null);setSlots([]);setConfirm(false);}} /></label>
    </div>
    {options?.hasMore && <p>候補が多いため20件まで表示しています。名前や学籍番号を詳しく入力してください。</p>}
    {options && !options.students.length && !student && <p>該当する生徒が見つかりません。</p>}
    <div className={styles.actions}>{options?.students.map(item=><button key={item.student_number} type="button" disabled={frozen} onClick={()=>work(async()=>{setStudent(item);await load(item);})}>
      {item.student_name}（{item.grade}・{item.campus || '校舎未登録'}・{item.student_number}）
    </button>)}</div>
    {student && <>
      <p className={styles.notice}>選択中：{student.student_name} ／ {student.grade} ／ {student.campus || '校舎未登録'} ／ {student.student_number}</p>
      <button type="button" disabled={frozen || !validDate} onClick={()=>work(()=>load())}>空席を再確認</button>
    </>}
    {student && options?.student && options.date===date && <form onSubmit={e=>{e.preventDefault();if(valid && !frozen)setConfirm(true);}}>
      <div className={styles.toolbar}><label className={styles.field}>希望座席<select value={seat} disabled={frozen || confirm} onChange={e=>{setSeat(Number(e.target.value));setSlots([]);}}>
        {Array.from({length:10},(_,i)=>i+1).map(n=><option key={n} value={n}>{n}番席</option>)}
      </select></label></div>
      <fieldset disabled={frozen || confirm} style={{padding:16,border:'1px solid #bbc6bf'}}><legend>希望時間帯</legend>{slots.map(slot=>{
        const unavailable = options.closedSlotIds.includes(slot) || options.pendingSlotIds.includes(slot) || options.studentSlotIds.includes(slot) || options.booked.some(b=>b.seat===seat && b.slotId===slot);
        return <label key={slot} style={{display:'block',margin:'10px 0'}}><input type="checkbox" checked={selectedSlots.includes(slot)} disabled={unavailable} onChange={e=>setSlots(items=>e.target.checked ? [...items,slot] : items.filter(s=>s!==slot))} /> {slot}{unavailable ? '（利用不可・予約済み・申請済み）' : ''}</label>;
      })}</fieldset>
      <p>{options.limitMinutes ? `1人${options.limitMinutes}分まで／確定済み${options.studentMinutes}分` : 'この日の時間上限は設定されていません。'}</p>
      <div className={styles.form}>
        <label className={styles.field}>連絡方法<select disabled={frozen || confirm} value={channel} onChange={e=>setChannel(e.target.value)}>
          <option value="line_message">LINE個別メッセージ</option><option value="in_person">来室時の申出</option><option value="phone">電話</option><option value="other">その他</option>
        </select></label>
        <label className={styles.field}>受付内容・理由（必須）<textarea required maxLength={2000} disabled={frozen || confirm} value={note} onChange={e=>setNote(e.target.value)} /></label>
        {!confirm && <button className={styles.primary} disabled={frozen || !valid}>申請内容を確認</button>}
      </div>
      {confirm && !pending && <div className={styles.confirm}><p>{student.student_name} さん ／ {date} ／ {seat}番席<br/>{selectedSlots.join('、')}</p>
        <p>これは代理申請の受付です。登録だけでは予約は確定しません。</p>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={frozen || !valid} onClick={()=>submit({operationKey:crypto.randomUUID(),studentNumber:student.student_number,date,seat,slotIds:[...selectedSlots].sort(),contactChannel:channel,note})}>承認待ちとして登録</button>
          <button type="button" disabled={busy} onClick={()=>setConfirm(false)}>内容を修正</button></div>
      </div>}
    </form>}
    {pending && <button type="button" disabled={busy} onClick={()=>submit(pending)}>同じ申請の結果を再確認</button>}
  </section>;
}
