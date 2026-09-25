import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../src/lib/interview-core.mjs';
import {availabilityStartTime,planTeacherAvailability,resolveAvailabilityTeacher,resolveDayCampus,schoolLessonInterval} from '../src/lib/bensuke-availability-auto.mjs';

test('授業日誌の12時間表記を午後の授業として扱う',()=>{
 assert.deepEqual(schoolLessonInterval('4:55～6:15'),[16*60+55,18*60+15]);
 assert.deepEqual(schoolLessonInterval('8:25～9:55'),[20*60+25,21*60+55]);
 assert.deepEqual(schoolLessonInterval('13:00～14:20'),[13*60,14*60+20]);
});

test('13時を除き、工藤の授業と予備時間に重ならない45分枠だけを作る',()=>{
 const rows=planTeacherAvailability({date:'2026-10-01',teacher:'工藤',settings:defaults,lessons:[{lesson_date:'2026-10-01',teacher_name:'工藤',campus:'本校',start_time:'4:55～6:15'}]});
 assert.deepEqual(rows.map(row=>[row.start,row.end,row.busyStart,row.busyEnd]),[
  ['14:00','14:45','14:00','15:00'],['15:00','15:45','15:00','16:00'],
  ['18:40','19:25','18:35','20:05'],['20:30','21:15','20:30','21:30'],['21:30','22:15','21:30','22:30'],
 ]);
});

test('授業コマの時間帯でも本人の授業がなければ作成する',()=>{
 const rows=planTeacherAvailability({date:'2026-10-02',teacher:'工藤',settings:defaults,lessons:[{lesson_date:'2026-10-02',teacher_name:'工藤',campus:'本校',start_time:'8:25～9:55'}]});
 assert.deepEqual(rows.map(row=>row.start),['14:00','15:00','16:00','17:00','18:40']);
});

test('金城先生だけに60分・50分の固定枠を作り、授業がない日は⑩を最終枠にする',()=>{
 const date='2026-10-02',lessons=[{lesson_date:date,teacher_name:'金城',campus:'本校',start_time:'10:00～10:30'}];
 const rows=planTeacherAvailability({date,teacher:'金城',settings:defaults,lessons});
 assert.deepEqual(rows.map(row=>[row.start,row.end]),[
  ['11:00','12:00'],['12:10','13:10'],['13:20','14:20'],['14:30','15:30'],['15:40','16:40'],
  ['17:15','18:15'],['18:35','19:25'],['19:30','20:20'],['20:25','21:15'],['21:25','22:15'],
 ]);
 assert.ok(rows.every(row=>row.busyEnd===row.end&&row.availabilityRule==='kinjo'));
 assert.deepEqual(planTeacherAvailability({date,teacher:'工藤',settings:defaults,lessons:lessons.map(row=>({...row,teacher_name:'工藤'}))}).map(row=>row.start).slice(0,2),['14:00','15:00']);
});

test('金城先生の20:25〜21:55授業日は⑨⑩を外し、終了なしの⑪だけを追加する',()=>{
 const date='2026-10-03',lessons=['10:00～10:30','8:25～9:55','2:55～4:25'].map(start_time=>({lesson_date:date,teacher_name:'金城',campus:'本校',start_time}));
 const rows=planTeacherAvailability({date,teacher:'金城',settings:defaults,lessons});
 assert.deepEqual(rows.map(row=>row.start),['11:00','12:10','13:20','17:15','18:35','19:30','22:05']);
 assert.deepEqual(rows.at(-1),{date,teacher:'金城',campus:'本校',start:'22:05',end:'',busyStart:'22:05',busyEnd:'23:59',availabilityRule:'kinjo'});
 const booked={status:'confirmed',data:{date,teacher:'金城',busyStart:'18:35',busyEnd:'19:25'}};
 assert.equal(planTeacherAvailability({date,teacher:'金城',settings:defaults,lessons,bookings:[booked]}).some(row=>row.start==='19:30'),true);
});

test('開始時間11:00なら11:00・12:00・13:00を追加し、14:00初期設定では13:00を除く',()=>{
 const options={date:'2026-10-02',teacher:'工藤',settings:defaults,lessons:[{lesson_date:'2026-10-02',teacher_name:'工藤',campus:'本校',start_time:'8:25～9:55'}]};
 assert.deepEqual(planTeacherAvailability({...options,startTime:'11:00'}).map(row=>row.start).slice(0,7),['11:00','12:00','13:00','14:00','15:00','16:00','17:00']);
 assert.equal(planTeacherAvailability(options).some(row=>row.start==='13:00'),false);
 assert.equal(planTeacherAvailability({...options,startTime:'15:00'}).some(row=>row.start==='14:00'),false);
 assert.throws(()=>availabilityStartTime('11:30'),/開始時間/);
});

test('授業がない日や複数校舎の日は自動登録しない',()=>{
 assert.throws(()=>planTeacherAvailability({date:'2026-10-01',teacher:'工藤',settings:defaults,lessons:[]}),/勤務日/);
 assert.throws(()=>planTeacherAvailability({date:'2026-10-01',teacher:'工藤',settings:defaults,lessons:[{lesson_date:'2026-10-01',teacher_name:'工藤',campus:'本校',start_time:'4:55～6:15',label:'小４X 算数'},{lesson_date:'2026-10-01',teacher_name:'工藤',campus:'南教室',start_time:'8:25～9:55',label:'中１S 数学'}]}),/勤務校舎/);
});

test('10月5日の両校舎記載は南教室だけの別授業を根拠に判定する',()=>{
 const lessons=[{campus:'本校',start_time:'4:55～6:15',grade:'e4',class_name:'X',subject:'arith',label:'小４X 算数'},
  {campus:'南教室',start_time:'4:55～6:15',grade:'e4',class_name:'X',subject:'arith',label:'小４X 算数'},
  {campus:'南教室',start_time:'6:35～8:05',grade:'j1',class_name:'S',subject:'math',label:'中１S 数学'}].map(row=>({...row,lesson_date:'2026-10-05',teacher_name:'工藤'}));
 assert.equal(resolveDayCampus(lessons),'南教室');
 assert.ok(planTeacherAvailability({date:'2026-10-05',teacher:'工藤',lessons,settings:defaults}).every(row=>row.campus==='南教室'));
 assert.throws(()=>resolveDayCampus(lessons,'本校'),/一致しません/);
});

test('10月29日の同一授業が両校舎に載る場合は勤務先を尋ねる',()=>{
 const lessons=['本校','南教室'].map(campus=>({lesson_date:'2026-10-29',teacher_name:'工藤',campus,start_time:'6:35～8:05',grade:'j2',class_name:'X',subject:'math',label:'中２X 数学'}));
 assert.throws(()=>resolveDayCampus(lessons),/校舎を選んでください/);
 assert.equal(resolveDayCampus(lessons,'本校'),'本校');
 assert.equal(resolveDayCampus(lessons,'南教室'),'南教室');
});

test('ログイン職員を授業表・Notionの先生名へ安全に対応付ける',()=>{
 assert.equal(resolveAvailabilityTeacher({displayName:'工藤謙',staffCode:'KUDO',candidates:['工藤先生','金城先生']}),'工藤');
 assert.equal(resolveAvailabilityTeacher({displayName:'金城正樹',staffCode:'OTHER',candidates:['工藤','金城']}),'金城');
 assert.equal(resolveAvailabilityTeacher({displayName:'髙山 太郎',staffCode:'TAKAYAMA',candidates:['高山先生']}),'髙山');
 assert.throws(()=>resolveAvailabilityTeacher({displayName:'未登録職員',staffCode:'OTHER',candidates:['工藤','金城']}),/特定できません/);
});
