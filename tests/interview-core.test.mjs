import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeRecordDraft,validateRecord} from '../src/lib/interview-record.mjs';
import {defaults,validateSettings,validateAppointment,generateSlots,conflicts} from '../src/lib/interview-core.mjs';
const date='2026-11-02';
const lesson={lesson_date:date,start_time:'16:45～18:15',teacher_name:'髙山',campus:'本校',classroom:'1'};
const base={studentId:'00000000-0000-4000-8000-000000000001',teacher:'髙山',date,start:'13:00',campus:'本校',method:'対面',purpose:'進路相談',participants:'本人、母',channel:'電話',room:''};

test('予定から記録を補完し、実際の時刻・参加者を独立して保存する',()=>{
 const appointment={...base,date:'2026-01-01',end:'13:45'};
 const draft=makeRecordDraft(appointment);assert.equal(draft.actualParticipants,'本人、母');assert.equal(draft.actualStart,'13:00');
 const saved=validateRecord({...draft,actualStart:'13:05',actualEnd:'13:50',actualParticipants:'母',content:'面談内容',decisions:'宿題の見直し',staffTasks:'教材を準備',familyRequests:'毎日の記録',nextReviewDate:'2026-02-01',memo:'補足',state:'final'},appointment,'record','2026-01-02');
 assert.equal(saved.actualStart,'13:05');assert.equal(saved.decisions,'宿題の見直し');assert.equal(saved.schemaVersion,1);assert.equal(appointment.start,'13:00');
 assert.deepEqual(makeRecordDraft({...appointment,record:saved}),saved);
});

test('空の下書きは保存でき、確定時は内容と実績を必須にする',()=>{
 const appointment={...base,date:'2026-01-01',end:'13:45'};
 const draft=makeRecordDraft(appointment);assert.equal(validateRecord(draft,appointment,'complete','2026-01-02').state,'draft');
 assert.throws(()=>validateRecord({...draft,state:'final'},appointment,'record','2026-01-02'),/確定するには/);
 assert.throws(()=>validateRecord({...draft,actualEnd:'12:00'},appointment,'record','2026-01-02'),/時刻/);
 assert.throws(()=>validateRecord({...draft,actualDate:'2027-01-01'},appointment,'record','2026-01-02'),/実施日/);
 assert.throws(()=>validateRecord({...draft,nextReviewDate:'2026-02-30'},appointment,'record','2026-01-02'),/次回確認日/);
 const long=validateRecord({...draft,content:'あ'.repeat(5000),state:'final'},appointment,'record','2026-01-02');assert.equal(long.content.length,5000);
 assert.throws(()=>validateRecord({...draft,content:'あ'.repeat(5001)},appointment,'record','2026-01-02'),/文字数/);
});
test('既決の45分・予備15分と13時以降を守り、授業と重なる枠を除く',()=>{
 const rows=generateSlots({date,teacher:'高山',campus:'本校',lessons:[lesson]});
 assert.ok(rows.some(r=>r.start==='13:00'&&r.end==='13:45'));
 assert.ok(!rows.some(r=>r.start<'13:00'||r.start==='16:00'||r.start==='17:00'));
 assert.ok(rows.some(r=>r.start==='20:30'&&r.end==='21:15'));
 assert.ok(rows.some(r=>r.start==='21:30'&&r.end==='22:15'));
});
test('18:35〜20:05は5分刻み、19:20が最後で1件が時間帯全体を占有',()=>{
 const row=validateAppointment({...base,start:'19:20'});
 assert.equal(row.end,'20:05');assert.equal(row.busyStart,'18:35');assert.equal(row.busyEnd,'20:05');
 const slots=generateSlots({date,teacher:'髙山',campus:'本校',lessons:[lesson],bookings:[{id:'b',status:'confirmed',data:row}]});
 assert.ok(!slots.some(s=>s.start>='18:35'&&s.start<'20:05'));
 assert.throws(()=>validateAppointment({...base,start:'19:25'}));
 assert.throws(()=>validateAppointment({...base,start:'18:36'}));
});
test('日付・教室・時刻・必須項目を検査し、夜中へ持ち越さない',()=>{
 for(const patch of [{date:'2026-02-30'},{start:'24:00'},{start:'23:30'},{participants:''},{campus:'不明'},{room:'x'}])assert.throws(()=>validateAppointment({...base,...patch}));
});
test('授業のない日を勝手に勤務日として扱わない',()=>{
 assert.deepEqual(generateSlots({date,teacher:'工藤',campus:'本校',lessons:[lesson]}),[]);
 assert.deepEqual(generateSlots({date,teacher:'髙山',campus:'南教室',lessons:[lesson]}),[]);
});
test('校舎をまたぐ担当授業、教室占有、担当不明も確認',()=>{
 const booking=validateAppointment({...base,start:'16:45',campus:'南教室'});
 assert.match(conflicts(booking,[lesson],[]).join(),/担当講師/);
 assert.match(conflicts({...booking,campus:'本校',teacher:'別講師',room:'1'},[lesson],[]).join(),/教室/);
 assert.match(conflicts(booking,[{...lesson,teacher_name:null}],[]).join(),/担当不明/);
 assert.throws(()=>conflicts(booking,[{...lesson,start_time:'不明'}],[]));
});
test('他講師による同一生徒予約も重複、取消済みは解放、隣接は許可',()=>{
 const a=validateAppointment(base),b={id:'b',status:'pending',data:{...a,teacher:'別講師'}};
 assert.match(conflicts(a,[],[b]).join(),/同じ生徒/);
 assert.deepEqual(conflicts(a,[],[{...b,status:'cancelled'}]),[]);
 assert.deepEqual(conflicts({...a,id:'b'},[],[b]),[]);
 assert.deepEqual(conflicts(validateAppointment({...base,start:'14:00'}),[],[b]),[]);
});
test('Notionの既存予定は担当または教室で重複を防ぐ',()=>{
 const a=validateAppointment(base);
 assert.match(conflicts(a,[],[],[{date,start:'13:30',end:'14:30',teachers:['高山']}]).join(),/Notion/);
});
test('設定を変更でき、不正な時間・日またぎは拒否',()=>{
 assert.equal(validateSettings({...defaults,duration:30}).duration,30);
 for(const patch of [{step:0},{duration:200},{flexibleEnd:'18:40'},{evening:['23:30']}])assert.throws(()=>validateSettings({...defaults,...patch}));
});
