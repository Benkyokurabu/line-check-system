"use client";
import {useState} from 'react';
import {destinations} from './staff-visit';
import styles from './staff-study-room.module.css';
type Snapshot={started_at:string|null;ended_at:string|null;destination:string|null};
type Entry={version:number;reason:string;recorded_at:string;staff_name:string;staff_code:string;before_state:Snapshot|null;after_state:Snapshot};
type Props={requestId:string;busy:boolean;request:(url:string)=>Promise<unknown>;work:(task:()=>Promise<void>)=>Promise<void>};
function format(value:string|null) {return value?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'未確認';}
function snapshot(value:Snapshot|null) {return value?<><p>開始：{format(value.started_at)}</p><p>終了：{format(value.ended_at)}</p><p>移動先：{value.destination?destinations[value.destination]??'未確認':'未記録'}</p></>:<p>記録なし</p>;}
export default function VisitHistory({requestId,busy,request,work}:Props) {
  const [events,setEvents]=useState<Entry[]>([]);const [open,setOpen]=useState(false);const [more,setMore]=useState(false);
  function load(older=false) {
    return work(async()=>{
      const params=new URLSearchParams({request:requestId});
      if(older && events.length) params.set('before',String(events[events.length-1].version));
      if(!older) {setEvents([]);setMore(false);setOpen(false);}
      try {
        const data=await request(`/api/staff/study-room/visit-history?${params}`) as {events:Entry[];hasMore:boolean};
        setEvents(items=>older?[...items,...data.events]:data.events);setMore(data.hasMore);setOpen(true);
      } catch(error) {setEvents([]);setMore(false);setOpen(false);throw error;}
    });
  }
  return <div className={styles.evidence}>
    <button disabled={busy} onClick={()=>load()}>来室・退室の履歴を確認</button>
    {open && <section aria-label="来室・退室の変更履歴"><p>新しい順に表示。時刻は日本時間、担当者名は現在の登録名です。</p>
      {!events.length && <p>来室・退室の記録履歴はありません。</p>}
      {events.map(event=><div className={styles.evidence} key={event.version}><h3>第{event.version}版</h3>
        <p>記録日時：{format(event.recorded_at)}</p><p>担当：{event.staff_name}（{event.staff_code}）</p>
        <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>理由：{event.reason||'理由なし（通常の来室・退室記録）'}</p>
        <h4>変更前</h4>{snapshot(event.before_state)}<h4>変更後</h4>{snapshot(event.after_state)}
      </div>)}
      <div className={styles.actions}>{more && <button disabled={busy} onClick={()=>load(true)}>さらに古い20件を表示</button>}
        <button disabled={busy} onClick={()=>{setOpen(false);setEvents([]);setMore(false);}}>履歴を閉じる</button></div>
    </section>}
  </div>;
}
