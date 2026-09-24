import {clock,minutes,normalizeTeacher,overlaps} from './interview-core.mjs';

const teacherKey=value=>normalizeTeacher(value).replace(/(?:先生|さん)$/u,'');

/** @param {{displayName:string,staffCode?:string,candidates?:Array<unknown>}} input */
export function resolveAvailabilityTeacher({displayName,staffCode='',candidates=[]}){
 const display=teacherKey(displayName),known={KUDO:'工藤',KINJO:'金城'}[String(staffCode).toUpperCase()];
 const names=[...new Set(candidates.map(teacherKey).filter(Boolean))];
 if(known&&names.includes(known))return known;
 const matches=names.filter(name=>display===name||display.startsWith(name)||name.startsWith(display)).sort((a,b)=>b.length-a.length);
 if(matches.length&&(!matches[1]||matches[0].length>matches[1].length))return matches[0];
 if(known)return known;
 throw Error(matches.length?'職員名に対応する先生を一意に特定できません。':'職員名に対応する先生を授業表・Notionから特定できません。');
}

export function schoolLessonInterval(value){
 const match=String(value??'').normalize('NFKC').match(/(\d{1,2}:[0-5]\d)\s*[～〜~\-–－]\s*(\d{1,2}:[0-5]\d)/);
 if(!match)throw Error('授業時間を読み取れません。');
 const normalize=value=>{let result=minutes(value.padStart(5,'0'));if(result<10*60)result+=12*60;return result;};
 const start=normalize(match[1]),end=normalize(match[2]);
 if(end<=start)throw Error('授業の終了時刻を確認してください。');
 return [start,end];
}

export class CampusChoiceNeeded extends Error {
 constructor(){super('同じ授業が本校と南教室の両方に載っています。実際に勤務する校舎を選んでください。');}
}

const lessonKey=row=>[row.start_time,row.grade,row.class_name,row.subject,row.label].map(value=>String(value??'').normalize('NFKC').replace(/\s/g,'')).join('|');

export function resolveDayCampus(teacherLessons,campusChoice=''){
 if(!teacherLessons.length)throw Error('担当授業がないため勤務日と判断できません。');
 if(teacherLessons.some(row=>!['本校','南教室'].includes(row.campus)))throw Error('校舎が不明な授業があります。スケジュール表を確認してください。');
 const byLesson=Map.groupBy(teacherLessons,lessonKey);
 const exclusive=new Set([...byLesson.values()].filter(group=>new Set(group.map(row=>row.campus)).size===1).map(group=>group[0].campus));
 if(exclusive.size>1)throw Error('同日に本校と南教室で異なる授業があります。勤務校舎を確認してください。');
 const campuses=new Set(teacherLessons.map(row=>row.campus));
 const resolved=exclusive.values().next().value??(campuses.size===1?campuses.values().next().value:'');
 if(resolved){if(campusChoice&&campusChoice!==resolved)throw Error('スケジュール表の授業と選択した校舎が一致しません。');return resolved;}
 if(!['本校','南教室'].includes(campusChoice))throw new CampusChoiceNeeded();
 return campusChoice;
}

export function availabilityStartTime(value='14:00'){
 if(typeof value!=='string'||!/^(?:09|1[0-7]):00$/.test(value))throw Error('開始時間は09:00〜17:00の毎時から選んでください。');
 return value;
}

/** @param {{date:string,teacher:string,lessons:Array<{lesson_date:string,teacher_name?:string,campus?:string,start_time?:string}>,bookings?:Array<{status:string,data?:Record<string,string>}>,settings:{duration:number,buffer:number,daytime:string[],evening:string[],flexibleStart:string,flexibleEnd:string},campusChoice?:string,startTime?:string}} input */
export function planTeacherAvailability({date,teacher,lessons,bookings=[],settings,campusChoice='',startTime='14:00'}){
 availabilityStartTime(startTime);
 const key=normalizeTeacher(teacher),teacherLessons=lessons.filter(row=>row.lesson_date===date&&normalizeTeacher(row.teacher_name)===key);
 const campus=resolveDayCampus(teacherLessons,campusChoice),duration=settings.duration,buffer=settings.buffer;
 const standard=settings.daytime.filter(start=>start!=='13:00').sort(),first=standard.length?minutes(standard[0]):minutes('14:00');
 const earlier=[];for(let time=minutes(startTime);time<first;time+=60)earlier.push(clock(time));
 const starts=[...earlier,...standard.filter(start=>minutes(start)>=minutes(startTime)),'18:40',...settings.evening];
 return [...new Set(starts)].sort().flatMap(start=>{
  const slotStart=minutes(start),flexible=slotStart>=minutes(settings.flexibleStart)&&slotStart<minutes(settings.flexibleEnd);
  const from=flexible?minutes(settings.flexibleStart):slotStart,to=flexible?minutes(settings.flexibleEnd):slotStart+duration+buffer;
  const lessonConflict=teacherLessons.some(row=>{const [a,b]=schoolLessonInterval(row.start_time);return overlaps(from,to,a,b);});
  const bookingConflict=bookings.some(row=>!['cancelled','rejected'].includes(row.status)&&row.data?.date===date&&normalizeTeacher(row.data?.teacher)===key&&overlaps(from,to,minutes(row.data.busyStart),minutes(row.data.busyEnd)));
  return lessonConflict||bookingConflict?[]:[{date,teacher,campus,start,end:clock(slotStart+duration),busyStart:clock(from),busyEnd:clock(to)}];
 });
}
