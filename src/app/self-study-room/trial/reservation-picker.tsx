'use client';
import Image from 'next/image';
import {useState} from 'react';
import {toggleReservationSlot} from '@/lib/reservation-slot-selection.mjs';
import {STUDY_ROOM_TRIAL_SLOTS as slots} from '@/lib/study-room-trial-slots.mjs';
import styles from '../menu-preview/reservation-demo.module.css';

// These are the same centers over the unchanged, user-supplied floor plan.
const positions=[{seat:1,x:14,y:82},{seat:2,x:14,y:69},{seat:3,x:14,y:56},
 {seat:4,x:14,y:43},{seat:5,x:14,y:30},{seat:6,x:14,y:17},
 {seat:7,x:64,y:24.5},{seat:8,x:83.5,y:24.5},{seat:9,x:64,y:37.3},{seat:10,x:83.5,y:37.3}];
type Props={selected:string[];seat:number|null;disabled:boolean;booked:{seat:number;slotId:string}[];closedSlotIds:string[];ownSlotIds:string[];onSelect:(slots:string[],seat:number|null)=>void};
export default function ReservationPicker({selected,seat,disabled,booked,closedSlotIds,ownSlotIds,onSelect}:Props){
 const [message,setMessage]=useState('');
 const blocked=slots.map((slot,index)=>closedSlotIds.includes(slot)||ownSlotIds.includes(slot)||new Set(booked.filter(b=>b.slotId===slot).map(b=>b.seat)).size>=10?index:-1).filter(i=>i>=0);
 const occupied=(selection:string[])=>new Set(booked.filter(b=>selection.includes(b.slotId)).map(b=>b.seat));
 const busySeats=occupied(selected);
 function update(next:string[]){setMessage('');const busy=occupied(next);onSelect(next,!next.length||seat!==null&&busy.has(seat)?null:seat);}
 function toggle(index:number){const next=toggleReservationSlot(selected.map(s=>slots.indexOf(s)),index,blocked,slots.length);if(next.blocked){setMessage('間に利用できない時間帯があるため、選択を広げられません。現在の選択は残しています。');return;}update(next.selection.map(i=>slots[i]));}
 return <>
  <h2>時間帯を選ぶ</h2><p>選択済みの時間帯は、もう一度タップするとそのコマだけ解除できます。離れた時間帯へ広げると間も追加されますが、解除した間のコマはそのままです。飛び飛びでも選べます。</p>
  <div className={styles.actions}><button disabled={disabled||blocked.length===slots.length} onClick={()=>update(slots.filter((_,i)=>!blocked.includes(i)))}>空きのある時間帯をまとめて選ぶ</button><button disabled={disabled||selected.length===0} onClick={()=>update([])}>選択をクリア</button></div>
  <div className={styles.slots}>{slots.map((slot,index)=><button key={slot} className={`${styles.slot} ${selected.includes(slot)?styles.selected:''}`} aria-pressed={selected.includes(slot)} disabled={disabled||blocked.includes(index)} onClick={()=>toggle(index)}><span>{slot.replace('-','–')}</span><small>{ownSlotIds.includes(slot)?'申請済み':blocked.includes(index)?'選択不可':'空きあり'}</small></button>)}</div>
  <p aria-live="polite">{selected.length?`${selected.length}コマ選択中：${selected.map(s=>s.replace('-','–')).join(' ／ ')}`:'時間帯を選んでください。'}</p>
  {message&&<p role="status" className={styles.notice}>{message}</p>}
  <h2>配置図から席を選ぶ</h2><p>選んだ全時間帯で空いている席を選べます。灰色の席は、いずれかの時間帯が予約済みです。</p>
  <p className={styles.small}>満席の時間帯は選べません。時間帯を広げたとき、選択中の席が使えなくなる場合は席を選び直します。</p>
  <div className={styles.map} role="group" aria-label="本校自習室の配置図から座席選択">
   <Image src="/main-study-room-seat-map.png" alt="本校自習室の配置図。左側に下から1〜6番席、右上に7・8番席と9・10番席。出入口は右側、本棚は右下。" width={1086} height={1448} className={styles.mapImage} priority unoptimized/>
   {positions.map(({seat:n,x,y})=><button key={n} style={{left:`${x}%`,top:`${y}%`}} aria-label={`${n}番席${busySeats.has(n)?' 予約済み':''}`} aria-pressed={seat===n} disabled={disabled||!selected.length||busySeats.has(n)} className={seat===n?styles.selected:''} onClick={()=>onSelect(selected,n)}>{n}</button>)}
  </div><p aria-live="polite">{seat?`${seat}番席を選択中`:'席を選んでください。'}</p>
 </>;
}
