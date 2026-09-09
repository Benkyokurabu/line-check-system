import { getJapanDate, isValidReservationDate } from './reservation-date.mjs';

// Pure trial state machine. The API authenticates staff and persists its snapshot
// separately from real reservations, with an optimistic version check.
export function createStaffStudyRoomTrial(saved = null, empty = false) {
  const slots=['14:55-16:25','16:45-18:15','18:35-20:05','20:25-21:55'];
  const students=[{student_number:'TRIAL001',student_name:'操作確認用 生徒A',grade:'中1',campus:'本校'},
    {student_number:'TRIAL002',student_name:'操作確認用 生徒B',grade:'中2',campus:'南教室'},
    {student_number:'TRIAL-KUDO',student_name:'工藤（確認用生徒）',grade:'確認用',campus:'本校'},
    {student_number:'TRIAL-KINJO',student_name:'金城（確認用生徒）',grade:'確認用',campus:'本校'}];
  let rows=[];
  const operations=new Map();
  const histories=new Map();
  function reset() {
    rows=empty?[]:[{id:'00000000-0000-4000-8000-000000000001',...students[0],reservation_date:getJapanDate(),
      seat:1,slot_ids:[slots[0]],status:'pending',version:1,request_kind:'same_day',intake_channel:'line_screen',visit:null}];
    operations.clear();histories.clear();
  }
  function fail(message,status=400){throw Object.assign(new Error(message),{status});}
  function handle(rawUrl,init,staff) {
    if(!['admin','office'].includes(staff?.role))fail('操作確認は管理者・事務部のアカウントでログインしてください。',403);
    const url=new URL(rawUrl,'https://trial.invalid');
    const method=init?.method??'GET';
    const allowed=new Set(['requests','intake-options','intake','transition','visits','visit-history']);
    const endpoint=url.pathname.replace('/api/staff/study-room/','');
    if(!url.pathname.startsWith('/api/staff/study-room/')||!allowed.has(endpoint))fail('この操作は確認画面では利用できません。',404);
    if(method==='GET'){
      const date=url.searchParams.get('date')??getJapanDate();
      if(!isValidReservationDate(date))fail('日付を確認してください。');
      if(endpoint==='requests')return {requests:rows.filter(r=>r.reservation_date===date&&(!url.searchParams.get('status')||r.status===url.searchParams.get('status'))).map(r=>structuredClone(r)),hasMore:false,
        permissions:Object.fromEntries(['read','approve','cancel','submit','visit'].map(p=>[`study_room.${p}`,true]))};
      if(endpoint==='intake-options'){
        const query=(url.searchParams.get('query')??'').trim();
        const student=students.find(s=>s.student_number===url.searchParams.get('student'))??null;
        const same=rows.filter(r=>r.reservation_date===date);
        return {students:students.filter(s=>!query||Object.values(s).some(v=>v.includes(query))),hasMore:false,student,date,
          booked:same.filter(r=>r.status==='approved').flatMap(r=>r.slot_ids.map(slotId=>({seat:r.seat,slotId}))),
          closedSlotIds:[slots[3]],limitMinutes:270,studentMinutes:same.filter(r=>r.status==='approved'&&r.student_number===student?.student_number).reduce((n,r)=>n+r.slot_ids.length*90,0),
          studentSlotIds:same.filter(r=>r.status==='approved'&&r.student_number===student?.student_number).flatMap(r=>r.slot_ids),
          pendingSlotIds:same.filter(r=>r.status==='pending'&&r.student_number===student?.student_number).flatMap(r=>r.slot_ids)};
      }
      if(endpoint==='visit-history')return {events:structuredClone(histories.get(url.searchParams.get('request'))??[]),hasMore:false};
      fail('操作方法を確認してください。',405);
    }
    if(method!=='POST')fail('操作方法を確認してください。',405);
    const input=JSON.parse(init?.body??'{}');
    if(typeof input.operationKey!=='string'||!input.operationKey.length||input.operationKey.length>100)fail('操作IDがありません。');
    const key=JSON.stringify({endpoint,input});
    if(operations.has(input.operationKey)){
      const old=operations.get(input.operationKey);if(old.key!==key)fail('同じ操作IDで内容が変わりました。',409);
      return structuredClone(old.result);
    }
    let result;
    if(endpoint==='intake'){
      const pupil=students.find(s=>s.student_number===input.studentNumber);
      if(!pupil||!isValidReservationDate(input.date)||input.date<getJapanDate()||!Number.isInteger(input.seat)||input.seat<1||input.seat>10||!Array.isArray(input.slotIds)||!input.slotIds.length||new Set(input.slotIds).size!==input.slotIds.length||input.slotIds.some(s=>!slots.slice(0,3).includes(s)))fail('申請内容を確認してください。');
      if(!input.note?.trim()||!['line_message','phone','in_person','other'].includes(input.contactChannel))fail('受付理由と連絡方法を入力してください。');
      const conflict=rows.some(r=>r.reservation_date===input.date&&['pending','approved'].includes(r.status)&&r.student_number===pupil.student_number&&r.slot_ids.some(s=>input.slotIds.includes(s)));
      if(conflict)fail('この生徒は同じ時間帯に申請済みです。',409);
      const row={id:crypto.randomUUID(),...pupil,reservation_date:input.date,seat:input.seat,slot_ids:input.slotIds,status:'pending',version:1,
        request_kind:input.date===getJapanDate()?'same_day':'advance',intake_channel:'staff',visit:null,
        staff_intake:{contactChannel:input.contactChannel,note:input.note,createdAt:new Date().toISOString(),staffName:staff.displayName,staffCode:staff.staffCode}};
      if(rows.length>=200)fail('確認用の申請が200件あります。管理者が確認データを初期化してください。',409);
      rows.push(row);result={request:structuredClone(row)};
    }else{
      const row=rows.find(r=>r.id===input.requestId);if(!row)fail('申請が見つかりません。',404);
      if(endpoint==='transition'){
        if(input.expectedVersion!==row.version)fail('一覧を更新してください。',409);
        if(!['approve','reject','cancel'].includes(input.action)||!['pending','approved'].includes(row.status)||row.status==='approved'&&input.action!=='cancel')fail('この状態では操作できません。',409);
        if(input.action==='reject'&&!input.reason?.trim())fail('却下理由を入力してください。');
        if(input.action==='approve'){
          const other=rows.filter(r=>r.id!==row.id&&r.reservation_date===row.reservation_date&&r.status==='approved');
          if(other.some(r=>(r.seat===row.seat||r.student_number===row.student_number)&&r.slot_ids.some(s=>row.slot_ids.includes(s))))fail('同じ席または生徒の時間帯が予約済みです。',409);
          if(other.filter(r=>r.student_number===row.student_number).reduce((n,r)=>n+r.slot_ids.length*90,0)+row.slot_ids.length*90>270)fail('利用上限を超えています。',409);
        }
        row.status={approve:'approved',reject:'rejected',cancel:'cancelled'}[input.action];row.version++;
        result={request:structuredClone(row)};
      }else if(endpoint==='visits'){
        const time=value=>value===null||(typeof value==='string'&&Number.isFinite(Date.parse(value)));
        if(!time(input.startedAt)||!time(input.endedAt)||![null,'lesson','home','other'].includes(input.destination)
          ||typeof input.reason!=='string'||input.reason.length>2000)fail('記録内容を確認してください。');
        if(input.endedAt&&(!input.startedAt||Date.parse(input.endedAt)<Date.parse(input.startedAt))
          ||input.startedAt&&getJapanDate(new Date(input.startedAt))!==row.reservation_date
          ||input.endedAt&&getJapanDate(new Date(input.endedAt))!==row.reservation_date
          ||input.startedAt&&Date.parse(input.startedAt)>Date.now()
          ||input.endedAt&&Date.parse(input.endedAt)>Date.now())fail('来室・退室の日時を確認してください。');
        if(row.visit&&!input.reason.trim())fail('訂正理由を入力してください。');
        if(input.expectedVersion!==(row.visit?.version??0))fail('一覧を更新してください。',409);
        if(row.status!=='approved'&&!(row.status==='cancelled'&&row.visit))fail('確定した予約で記録してください。',409);
        const before=structuredClone(row.visit);
        const visit={version:input.expectedVersion+1,started_at:input.startedAt,ended_at:input.endedAt,destination:input.destination,confirmed_at:new Date().toISOString(),staff_name:staff.displayName};
        row.visit=visit;
        histories.set(row.id,[{version:visit.version,reason:input.reason??'',recorded_at:visit.confirmed_at,staff_name:staff.displayName,staff_code:staff.staffCode,before_state:before,after_state:structuredClone(visit)},...(histories.get(row.id)??[])]);
        result={visit};
      }else fail('この操作は確認画面では利用できません。',404);
    }
    operations.set(input.operationKey,{key,result:structuredClone(result)});
    return structuredClone(result);
  }
  reset();
  if(saved?.rows){rows=structuredClone(saved.rows);for(const [k,v] of saved.operations??[])operations.set(k,v);for(const [k,v] of saved.histories??[])histories.set(k,v);}
  function snapshot(){return structuredClone({rows,operations:[...operations],histories:[...histories]});}
  return {handle,reset,snapshot};
}
