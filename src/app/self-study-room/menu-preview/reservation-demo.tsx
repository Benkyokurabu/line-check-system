"use client";
import { useState } from "react";
import Image from "next/image";
import { getJapanDate, isValidReservationDate } from "@/lib/reservation-date.mjs";
import styles from "./reservation-demo.module.css";
import { toggleReservationSlot } from "@/lib/reservation-slot-selection.mjs";

const slots = ['14:55–16:25','16:45–18:15','18:35–20:05','20:25–21:55'];
const occupancy = [[3,7],[2,4,8],[5],[1,2,3,4,5,6,7,8,9,10]];
// Seat centers follow the supplied floor plan; the original image is unchanged.
const positions = [
  {seat:1,x:14,y:82},{seat:2,x:14,y:69},{seat:3,x:14,y:56},
  {seat:4,x:14,y:43},{seat:5,x:14,y:30},{seat:6,x:14,y:17},
  {seat:7,x:64,y:24.5},{seat:8,x:83.5,y:24.5},{seat:9,x:64,y:37.3},{seat:10,x:83.5,y:37.3},
];
type Stage = 'select'|'review'|'pending'|'confirmed'|'cancelled';

// Completely local demonstration: no fetch, API, storage, personal data or LINE send.
export default function ReservationDemo() {
  const [stage,setStage] = useState<Stage>('select');
  const [date,setDate] = useState(getJapanDate());
  const [selection,setSelection] = useState<number[]>([]);
  const [selectionMessage,setSelectionMessage] = useState('');
  const [seat,setSeat] = useState<number|null>(null);
  const [actor,setActor] = useState('student'); const [child,setChild] = useState('デモ生徒A');
  const [cancelCheck,setCancelCheck] = useState(false);
  const today = getJapanDate();
  const selectedSlots = selection.map(index=>slots[index]);
  const busySeats = [...new Set(selection.flatMap(index=>occupancy[index]))];
  const valid = isValidReservationDate(date) && date>=today && selection.length>0 && seat!==null && !busySeats.includes(seat);
  function reset(){setStage('select');setDate(getJapanDate());setSelection([]);setSeat(null);setCancelCheck(false);setSelectionMessage('');setActor('student');setChild('デモ生徒A');}
  function updateSelection(next:number[]) {
    setSelection(next);setSelectionMessage('');
    const blocked = next.flatMap(index=>occupancy[index]);
    setSeat(current=>next.length===0 || (current!==null && blocked.includes(current)) ? null : current);
  }
  function selectSlot(index:number) {
    const next=toggleReservationSlot(selection,index,[3],slots.length);
    if(next.blocked) {setSelectionMessage('間に満席の時間帯があるため、選択を広げられません。現在の選択は残しています。');return;}
    updateSelection(next.selection);
  }
  const summary = <div className={styles.summary}><strong>{actor==='student' ? 'デモ生徒A' : child} さん</strong>
    <p>本校自習室 ／ {date} ／ {seat}番席<br/>{selectedSlots.join(' ／ ')}<br/>{selectedSlots.length}コマ・{selectedSlots.length*90}分（休憩時間を除く）</p>
    <p>{actor==='guardian' ? '保護者による代理申請' : '生徒本人による申請'}{date===today ? '・当日申請' : '・事前申請'}</p></div>;
  return <main className={styles.screen}><section className={styles.panel}>
    <span className={styles.badge}>操作デモ・実際の予約は登録されません</span>
    <h1>勉強クラブ本校<br/>自習室予約</h1>
    <p>架空の空席で予約の流れを体験できます。個人情報の入力は不要です。</p>
    <div className={styles.steps} aria-label="予約の流れ">
      <span className={stage==='select' ? styles.current : ''}>① 日時・席</span>
      <span className={stage==='review' ? styles.current : ''}>② 内容確認</span>
      <span className={stage==='pending' ? styles.current : ''}>③ 承認待ち</span>
      <span className={stage==='confirmed' ? styles.current : ''}>④ 予約確定</span>
    </div>
    {stage==='select' && <>
      <label className={styles.field}>申請する人<select value={actor} onChange={e=>setActor(e.target.value)}><option value="student">生徒本人</option><option value="guardian">保護者（代理で申請）</option></select></label>
      {actor==='guardian' && <label className={styles.field}>利用するお子さま<select value={child} onChange={e=>setChild(e.target.value)}><option>デモ生徒A</option><option>デモ生徒B</option></select></label>}
      <label className={styles.field}>利用日<input type="date" min={today} value={date} onChange={e=>{setDate(e.target.value);setSeat(null);}} /></label>
      <p>{!isValidReservationDate(date) ? '利用日を選んでください。' : date<today ? '過去の日付は申請できません。' : date===today ? '当日の申請も、空席があれば受け付けます。' : '前日の23:59まで事前申請できます。'}</p>
      <h2>時間帯を選ぶ</h2>
      <p>選択済みの時間帯は、もう一度タップするとそのコマだけ解除できます。離れた時間帯へ広げると間も追加されますが、解除した間のコマはそのままです。飛び飛びでも選べます。</p>
      <div className={styles.actions}><button onClick={()=>updateSelection([0,1,2])}>空きのある3コマをまとめて選ぶ</button><button disabled={selection.length===0} onClick={()=>updateSelection([])}>選択をクリア</button></div>
      <div className={styles.slots}>{slots.map((label,index)=><button key={label} className={`${styles.slot} ${selection.includes(index) ? styles.selected : ''}`} aria-pressed={selection.includes(index)} disabled={index===3} onClick={()=>selectSlot(index)}>
        <span>{label}</span><small>{index===3 ? '満席（例）' : '空きあり'}</small>
      </button>)}</div>
      <p aria-live="polite">{selection.length===0 ? '時間帯を選んでください。' : `${selectedSlots.length}コマ選択中：${selectedSlots.join(' ／ ')}`}</p>
      {selectionMessage && <p role="status" className={styles.notice}>{selectionMessage}</p>}
      <h2>配置図から席を選ぶ</h2><p>選んだ全時間帯で空いている席を選べます。灰色の席は、いずれかの時間帯が予約済みです。空席状況はデモ用です。</p>
      <p className={styles.small}>満席の時間帯は選べません。時間帯を広げたとき、選択中の席が使えなくなる場合は席を選び直します。</p>
      <div className={styles.map} role="group" aria-label="本校自習室の配置図から座席選択">
        <Image src="/main-study-room-seat-map.png" alt="本校自習室の配置図。左側に下から1〜6番席、右上に7・8番席と9・10番席。出入口は右側、本棚は右下。" width={1086} height={1448} className={styles.mapImage} priority unoptimized />
        {positions.map(({seat:n,x,y})=><button key={n} style={{left:`${x}%`,top:`${y}%`}} aria-label={`${n}番席${busySeats.includes(n) ? ' 予約済み' : ''}`} aria-pressed={seat===n} disabled={selection.length===0 || busySeats.includes(n)} className={seat===n ? styles.selected : ''} onClick={()=>setSeat(n)}>{n}</button>)}
      </div>
      <p aria-live="polite">{seat ? `${seat}番席を選択中` : '席を選んでください。'}</p>
      <button className={styles.primary} disabled={!valid} onClick={()=>setStage('review')}>申請内容を確認する</button>
    </>}
    {stage==='review' && <><h2>この内容で申請しますか？</h2>{summary}<p>申請しただけでは予約は確定しません。職員の確認・承認をお待ちください。</p>
      <button className={styles.primary} disabled={!valid} onClick={()=>{if(valid)setStage('pending');}}>この内容で申請する（デモ）</button><div className={styles.actions}><button onClick={()=>setStage('select')}>選び直す</button></div></>}
    {stage==='pending' && <><p className={styles.result} role="status">申請を受け付けました（承認待ち）</p>{summary}<p>まだ予約は確定していません。職員が内容と空席を確認して承認すると、予約が確定します。</p>
      <details className={styles.test}><summary>デモの続きを見る：職員の承認を再現</summary><p className={styles.small}>これは確認用の操作です。本番では生徒・保護者が自分で承認することはできません。</p><button className={styles.primary} onClick={()=>{setStage('confirmed');setCancelCheck(false);}}>職員が承認した状態に進む</button></details></>}
    {stage==='confirmed' && <><p className={styles.result} role="status">予約が確定しました</p>{summary}<p>当日は職員へ声をかけて、自習室を利用してください。</p><p className={styles.notice}>デモ上の確定です。実際の席の確保やLINE通知は行っていません。</p></>}
    {['pending','confirmed'].includes(stage) && <div className={styles.test}>{cancelCheck ? <><p>この申請・予約を取りやめますか？</p><div className={styles.actions}><button onClick={()=>{setStage('cancelled');setCancelCheck(false);}}>取りやめる（デモ）</button><button onClick={()=>setCancelCheck(false)}>戻る</button></div></> : <button onClick={()=>setCancelCheck(true)}>キャンセルの流れを試す</button>}</div>}
    {stage==='cancelled' && <><p className={styles.result} role="status">取りやめを受け付けました</p>{summary}<p>デモ上でキャンセルしました。実際の予約データは変更していません。</p></>}
    {stage!=='select' && <div className={styles.actions}><button onClick={reset}>最初から試す</button></div>}
    <p className={styles.small}>このデモは画面を閉じるとリセットされます。正式版の画面・文面は調整中です。</p>
  </section></main>;
}
