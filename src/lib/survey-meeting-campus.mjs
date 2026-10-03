import {resolveDayCampus} from './bensuke-availability-auto.mjs';
import {InterviewError,normalizeTeacher} from './interview-core.mjs';
const teacherKey=name=>normalizeTeacher(name).replace(/(?:先生|さん)$/u,'');
// Reuse the schedule-based campus decision from automatic availability.
export async function surveyMeetingCampus(db,date,teacher){
 if(!teacher||teacher==='未設定')return '';
 const result=await db.from('lessons').select('lesson_date,teacher_name,campus,start_time,grade,class_name,subject,label').eq('lesson_date',date).limit(1001);
 if(result.error||result.data?.length>1000)throw new InterviewError('先生の勤務校舎をスケジュール表から確認できません。',503);
 const rows=(result.data??[]).filter(row=>teacherKey(row.teacher_name)===teacherKey(teacher));
 if(!rows.length)return '';
 try{return resolveDayCampus(rows);}catch(error){throw new InterviewError(error.message,409);}
}
