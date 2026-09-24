import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../src/lib/interview-core.mjs';
import {planTeacherAvailability,resolveAvailabilityTeacher,schoolLessonInterval} from '../src/lib/bensuke-availability-auto.mjs';

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
 assert.throws(()=>planTeacherAvailability({date:'2026-10-01',teacher:'工藤',settings:defaults,lessons:[{lesson_date:'2026-10-01',teacher_name:'工藤',campus:'本校',start_time:'4:55～6:15'},{lesson_date:'2026-10-01',teacher_name:'工藤',campus:'南教室',start_time:'8:25～9:55'}]}),/複数校舎/);
});

test('ログイン職員を授業表・Notionの先生名へ安全に対応付ける',()=>{
 assert.equal(resolveAvailabilityTeacher({displayName:'工藤謙',staffCode:'KUDO',candidates:['工藤先生','金城先生']}),'工藤');
 assert.equal(resolveAvailabilityTeacher({displayName:'金城正樹',staffCode:'OTHER',candidates:['工藤','金城']}),'金城');
 assert.equal(resolveAvailabilityTeacher({displayName:'髙山 太郎',staffCode:'TAKAYAMA',candidates:['高山先生']}),'髙山');
 assert.throws(()=>resolveAvailabilityTeacher({displayName:'未登録職員',staffCode:'OTHER',candidates:['工藤','金城']}),/特定できません/);
});
