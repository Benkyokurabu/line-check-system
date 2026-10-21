import {InterviewError} from './interview-core.mjs';
import {isValidReservationDate} from './reservation-date.mjs';
export const parentContactFields=['teacher','task','start','end','contact','content','result'];
export const normalizeParentWorkLog=input=>({enabled:input?.enabled===true,...Object.fromEntries(parentContactFields.map(k=>[k,String(input?.[k]??'').trim().slice(0,k==='contact'?500:200)]))});
const teacherLabel=name=>{const value=String(name??'').trim();return value&&!value.endsWith('先生')?value+'先生':value;};
export const parentContactTeacherName=staff=>staff?.staffCode==='KUDO'?'工藤先生':teacherLabel(staff?.displayName);
export function parentContactTeacherChoice(current,teachers,staff){
 if(!current||teachers.includes(current))return current;
 const canonical=parentContactTeacherName(staff);
 // Only repair the old default generated from this authenticated staff member's full name.
 return current===teacherLabel(staff?.displayName)&&teachers.includes(canonical)?canonical:current;
}
export function parentContactOptionIssues(form,options){return [['teacher','teachers','氏名'],['task','tasks','摘要'],['content','contents','内容'],['result','results','結果']].filter(([key,list])=>form[key]&&!options[list]?.includes(form[key])).map(([key,,label])=>({key,label,value:form[key]}));}
export function parentContactMonth(value){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value??''))throw new InterviewError('業務記録の年月を確認してください。',422);return value;}
const minutes=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;
export function parentContactRow(payload,options){
 const form=normalizeParentWorkLog(payload.workLog),date=payload.fields?.date;
 const missing=[];if(date?.state!=='confirmed'||!isValidReservationDate(date.value))missing.push('実施日の確定');
 for(const [key,label]of [['teacher','氏名'],['task','摘要'],['start','開始時刻'],['end','終了時刻'],['contact','生徒名・相手'],['content','内容'],['result','結果']])if(!form[key])missing.push(label);
 if(missing.length)throw new InterviewError(`対保護者業務記録は「${missing.join('」「')}」の入力待ちです。他の保存済み記録は保持しています。`,409);
 const start=minutes(form.start),end=minutes(form.end);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new InterviewError('業務記録の開始・終了時刻を確認してください。終了は開始より後にしてください。',409);
 const [issue]=parentContactOptionIssues(form,options);if(issue)throw new InterviewError(`業務記録の「${issue.label}」（${issue.value}）がExcelの選択肢と一致しません。選択肢を読み込み直して選び直してください。`,409);
 return {month:date.value.slice(0,7),values:[`${Number(date.value.slice(8))}日`,form.teacher,form.task,start/1440,null,end/1440,null,form.contact,form.content,form.result],duration:(end-start)/1440};
}
const timeNumber=value=>typeof value==='number'?value:typeof value==='string'&&/^\d{1,2}:\d{2}$/.test(value)?(Number(value.split(':')[0])*60+Number(value.split(':')[1]))/1440:NaN;
export function parentRowMatches(current,desired){return [0,1,2,3,5,7,8,9].every(i=>[3,5].includes(i)?Math.abs(timeNumber(current?.[i])-desired[i])<1e-8:String(current?.[i]??'')===String(desired[i]??''));}
export const parentRowBlank=row=>[0,1,2,3,5,7,8,9].every(i=>row?.[i]==null||row[i]==='');
export const parentRowCompatible=(current,desired)=>[0,1,2,3,5,7,8,9].every(i=>current?.[i]==null||current[i]===''||([3,5].includes(i)?Math.abs(timeNumber(current[i])-timeNumber(desired?.[i]))<1e-8:String(current[i])===String(desired?.[i]??'')));
