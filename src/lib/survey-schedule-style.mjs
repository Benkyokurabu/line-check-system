import {isKinjoTeacher,kinjoInterviewSlot} from './kinjo-interview-slots.mjs';
export const scheduleMethods=['','2者Zoom','３者Zoom','４者Zoom','２者対面','３者対面','４者対面','電話','LINE'];
export function suggestedInterviewEnd(time,teacher){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return '';
 if(isKinjoTeacher(teacher)&&kinjoInterviewSlot(time))return kinjoInterviewSlot(time).end;
 const end=Number(time.slice(0,2))*60+Number(time.slice(3))+(isKinjoTeacher(teacher)?60:45);
 return end<1440?`${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`:'';
}
export function surveyScheduleStyle(student,method){
 if(!scheduleMethods.includes(method))throw Error('面談方法を確認してください。');
 const normalized=method.normalize('NFKC'),count={2:'二',3:'三',4:'四'}[normalized[0]],purpose=count?`${count}者面談`:method==='電話'?'電話面談':method==='LINE'?'LINE面談':'面談';
 const grade=String(student.grade??'').normalize('NFKC').replace(/\d/g,n=>String.fromCharCode(n.charCodeAt(0)+0xfee0));
 return {title:`${grade}${String(student.student_name??'').replace(/\s/g,'')}／${purpose}`,
  tag:normalized.includes('Zoom')?'面談(オンライン)':normalized.includes('対面')?'面談(対面)':method==='電話'?'電話':'面談予定'};
}
export function methodFromSurveySchedule(value){
 if(!value)return '３者Zoom';
 const count=value.title?.includes('二者')?'2':value.title?.includes('四者')?'４':'３';
 if(value.tags?.includes('面談(オンライン)'))return `${count}者Zoom`;
 if(value.tags?.includes('面談(対面)'))return `${count==='2'?'２':count}者対面`;
 return value.tags?.includes('電話')?'電話':value.title?.includes('LINE面談')?'LINE':'';
}
