import {STUDY_ROOM_TRIAL_SLOTS as slots} from '@/lib/study-room-trial-slots.mjs';
import styles from './student-availability.module.css';
export default function StudentAvailability({date,booked,closedSlotIds}:{date:string;booked:{seat:number;slotId:string}[];closedSlotIds:string[]}){
 return <section className={styles.overview} aria-label="時間帯別の座席状況">
  <h2>時間帯ごとの空き・予約済み</h2><p>{date} · 本校自習室</p>
  <p>○ 空き ／ × 予約済み ／ ― 利用不可<br/>承認待ちの申請は、まだ席を確保していません。</p>
  <table className={styles.table}>
   <caption>座席と時間帯の一覧（自動更新）</caption>
   <thead><tr><th scope="col">座席</th>{slots.map(slot=><th scope="col" key={slot}>{slot.split('-')[0]}<br/>–{slot.split('-')[1]}<small>{closedSlotIds.includes(slot)?'利用不可':`空き${10-new Set(booked.filter(b=>b.slotId===slot).map(b=>b.seat)).size}席`}</small></th>)}</tr></thead>
   <tbody>{Array.from({length:10},(_,i)=>i+1).map(seat=><tr key={seat}><th scope="row">{seat}番席</th>{slots.map(slot=>{
    const closed=closedSlotIds.includes(slot),taken=booked.some(b=>b.seat===seat&&b.slotId===slot);
    const label=closed?'利用不可':taken?'予約済み':'空き';
    return <td key={slot} className={closed||taken?styles.taken:styles.free} aria-label={`${seat}番席 ${slot.replace('-','–')} ${label}`}><b aria-hidden="true">{closed?'―':taken?'×':'○'}</b><span>{label}</span></td>;
   })}</tr>)}</tbody>
  </table>
 </section>;
}
