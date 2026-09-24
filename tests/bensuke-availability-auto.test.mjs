import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../src/lib/interview-core.mjs';
import {planTeacherAvailability,resolveAvailabilityTeacher,resolveDayCampus,schoolLessonInterval} from '../src/lib/bensuke-availability-auto.mjs';

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
