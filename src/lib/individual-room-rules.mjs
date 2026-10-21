// Room availability is independent of teacher leave and teacher availability.
export const individualRooms = ['本①','本②','本③','本④','本⑥'];
export const individualTimes = [
  {start:'16:45',end:'18:15',color:'blue'},
  {start:'18:35',end:'20:05',color:'purple'},
  {start:'20:25',end:'21:55',color:'gray'},
];
export function scheduleClock(value){
  const m=String(value).normalize('NFKC').match(/^(\d{1,2}):([0-5]\d)$/u);
  if(!m||Number(m[1])>23)return null;
  // Existing journal sheets use 4:45, 6:35 and 8:25 for afternoon/evening.
  return (Number(m[1])<10?Number(m[1])+12:Number(m[1]))*60+Number(m[2]);
}
export function scheduleInterval(value){
  const parts=String(value).normalize('NFKC').replace(/\s/gu,'').split(/[～〜~\-–]/u);
  const a=scheduleClock(parts[0]),b=scheduleClock(parts[1]);
  return parts.length===2&&a!==null&&b!==null&&a<b?[a,b]:null;
}
export const overlaps=(a,b)=>a[0]<b[1]&&b[0]<a[1];
export const individualKey=s=>`${s.date}|${s.start}|${s.room}`;
export const individualSort=(a,b)=>individualKey(a).localeCompare(individualKey(b),'ja');

// Same formula for every imported month. Booking removes only the existing tag.
export function individualDisplayFormula(){
  return 'if(empty(prop("日時")), "", lets(t, timestamp(dateStart(prop("日時"))), m, mod(floor(t / 60000) + 540, 1440), label, ifs(m == 1005, "16:45", m == 1115, "18:35", m == 1225, "20:25", true, ""), if(and(contains(prop("校舎"), "本校"), contains(prop("内容"), "個別指導")), if(contains(prop("内容"), "個別使用可能"), ifs(label == "16:45", style(label, "blue"), label == "18:35", style(label, "purple"), label == "20:25", style(label, "gray"), true, ""), unstyle(label)), "")))';
}

export function planIndividualRooms(roomSchedule,now=new Date()){
  if(roomSchedule?.format!=='bentan-room-schedule-v1'||!/^20\d{2}-(0[1-9]|1[0-2])$/u.test(roomSchedule.month)||!Array.isArray(roomSchedule.slots))throw Error('教室ごとの原表確認データがありません。個別枠の作成を保留します。');
  const seen=new Set(),future=[];
  for(const s of roomSchedule.slots){
    const key=individualKey(s),time=individualTimes.find(t=>t.start===s.start);
    if(seen.has(key)||!s.date.startsWith(`${roomSchedule.month}-`)||!individualRooms.includes(s.room)||!time||s.end!==time.end||!['free','occupied','review'].includes(s.status)||!Array.isArray(s.cells))throw Error('教室の空き判定を確認できません。');
    seen.add(key);
    const date=new Date(`${s.date}T00:00:00+09:00`);
    if(!Number.isFinite(date.getTime())||new Date(date.getTime()+9*3600000).toISOString().slice(0,10)!==s.date)throw Error('教室の日付が不正です。');
    // Follow the established Monday–Saturday availability style, never past slots.
    if(new Date(`${s.date}T12:00:00+09:00`).getUTCDay()===0||Date.parse(`${s.date}T${s.start}:00+09:00`)<=now.getTime())continue;
    future.push({...s});
  }
  return future.sort(individualSort);
}
