import {createHash} from 'node:crypto';

export function validInterviewDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function notionRecordText(value){
 const chars=Array.from(value),result=[];
 for(let i=0;i<chars.length;i+=1000)result.push({type:'text',text:{content:chars.slice(i,i+1000).join('')}});
 return result;
}

/** The same answer, phase, recipient and text always get the same LINE retry key. */
export function interviewLineRetryKey(surveyId,phase,lineUserId,message){
 const hex=createHash('sha256').update(JSON.stringify([surveyId,phase,lineUserId,message.trim()])).digest('hex');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
