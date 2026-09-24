import {clock,minutes,normalizeTeacher,overlaps} from './interview-core.mjs';

export function schoolLessonInterval(value){
 const match=String(value??'').normalize('NFKC').match(/(\d{1,2}:[0-5]\d)\s*[～〜~\-–－]\s*(\d{1,2}:[0-5]\d)/);
 if(!match)throw Error('授業時間を読み取れません。');
 const normalize=value=>{let result=minutes(value.padStart(5,'0'));if(result<10*60)result+=12*60;return result;};
 const start=normalize(match[1]),end=normalize(match[2]);
 if(end<=start)throw Error('授業の終了時刻を確認してください。');
 return [start,end];
}

export function planTeacherAvailability({date,teacher,lessons,bookings=[],settings}){
 const key=normalizeTeacher(teacher),teacherLessons=lessons.filter(row=>row.lesson_date===date&&normalizeTeacher(row.teacher_name)===key);
 const campuses=[...new Set(teacherLessons.map(row=>row.campus).filter(campus=>['本校','南教室'].includes(campus)))];
 if(campuses.length!==1)throw Error(campuses.length?'同日に複数校舎の授業があります。自動登録を停止しました。':'担当授業がないため勤務日と判断できません。');
 const campus=campuses[0],duration=settings.duration,buffer=settings.buffer;
 return [...new Set(settings.daytime)].sort().flatMap(start=>{
  const from=minutes(start),to=from+duration+buffer;
  const lessonConflict=teacherLessons.some(row=>{const [a,b]=schoolLessonInterval(row.start_time);return overlaps(from,to,a,b);});
  const bookingConflict=bookings.some(row=>!['cancelled','rejected'].includes(row.status)&&row.data?.date===date&&normalizeTeacher(row.data?.teacher)===key&&overlaps(from,to,minutes(row.data.busyStart),minutes(row.data.busyEnd)));
  return lessonConflict||bookingConflict?[]:[{date,teacher,campus,start,end:clock(from+duration),busyStart:start,busyEnd:clock(to)}];
 });
}
