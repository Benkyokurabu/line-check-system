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

export const RECORD_CAPTION='勉たん面談入力';
export function interviewDateParts(value){
 if(validInterviewDate(value))return {date:value,time:''};
 if(typeof value!=='string'||!value.includes('T')||Number.isNaN(Date.parse(value)))return {date:'',time:''};
 const date=new Date(value);
 return {date:date.toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}),time:date.toLocaleTimeString('sv-SE',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})};
}
/** Existing blocks are always retained; only the owned code block can be replaced. */
export function recordBlockState(blocks,pageEditedAt=''){
 const all=blocks.results??[];
 const plain=items=>(items??[]).map(x=>x.plain_text??x.text?.content??'').join('');
 const managed=all.filter(block=>block.type==='code'&&plain(block.code?.caption)===RECORD_CAPTION);
 const legacy=all.length===1&&all[0].type==='code'&&!all[0].has_children?all[0]:undefined;
 const first=managed.length===1?managed[0]:legacy;
 return {editable:!blocks.has_more&&managed.length<=1&&!first?.has_children,
  body:first?plain(first.code?.rich_text):'',blockId:first?.id??'',blockEditedAt:first?.last_edited_time??pageEditedAt,
  existingText:all.filter(block=>block!==first).map(block=>plain(block[block.type]?.rich_text)).filter(Boolean).join('\n\n')};
}
