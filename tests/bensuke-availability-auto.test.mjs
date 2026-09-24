import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../src/lib/interview-core.mjs';
import {planTeacherAvailability,schoolLessonInterval} from '../src/lib/bensuke-availability-auto.mjs';

test('授業日誌の12時間表記を午後の授業として扱う',()=>{
 assert.deepEqual(schoolLessonInterval('4:55～6:15'),[16*60+55,18*60+15]);
 assert.deepEqual(schoolLessonInterval('8:25～9:55'),[20*60+25,21*60+55]);
 assert.deepEqual(schoolLessonInterval('13:00～14:20'),[13*60,14*60+20]);
});

test('工藤の授業と予備時間に重ならない45分枠だけを作る',()=>{
 const rows=planTeacherAvailability({date:'2026-10-01',teacher:'工藤',settings:defaults,lessons:[{lesson_date:'2026-10-01',teacher_name:'工藤',campus:'本校',start_time:'4:55～6:15'}]});
 assert.deepEqual(rows.map(row=>[row.start,row.end,row.busyEnd]),[['13:00','13:45','14:00'],['14:00','14:45','15:00'],['15:00','15:45','16:00']]);
});

test('授業がない日や複数校舎の日は自動登録しない',()=>{
 assert.throws(()=>planTeacherAvailability({date:'2026-10-01',teacher:'工藤',settings:defaults,lessons:[]}),/勤務日/);
 assert.throws(()=>planTeacherAvailability({date:'2026-10-01',teacher:'工藤',settings:defaults,lessons:[{lesson_date:'2026-10-01',teacher_name:'工藤',campus:'本校',start_time:'4:55～6:15'},{lesson_date:'2026-10-01',teacher_name:'工藤',campus:'南教室',start_time:'8:25～9:55'}]}),/複数校舎/);
});
