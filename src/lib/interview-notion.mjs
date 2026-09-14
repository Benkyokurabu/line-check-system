import { InterviewError } from './interview-core.mjs';
const plain = p => (p?.title??p?.rich_text??[]).map(x=>x.plain_text??x.text?.content??'').join('');
export function scheduleSchema(schema){
  const props=Object.values(schema.properties??{});
  const find=(name,type)=>props.find(p=>p.name===name&&(!type||p.type===type));
  const title=find('名前','title'),date=find('日時','date'),teacher=find('担当者'),campus=find('校舎'),content=find('内容');
  const booking=find('予約ID','rich_text'),student=find('勉たん生徒ID','rich_text');
  if(!title||!date||!teacher||!campus||!content||!booking||!student)throw new InterviewError('Notionの面談予定用の項目が未設定です。名前・日時・担当者・校舎・内容・予約ID・勉たん生徒IDを確認してください。',503);
  return {title,date,teacher,campus,content,booking,student,room:find('教室')};
}
function value(property,text){
  if(['title','rich_text'].includes(property.type))return {[property.type]:[{type:'text',text:{content:text}}]};
  if(['select','multi_select'].includes(property.type)){
    const options=property[property.type].options;
    const option=options.find(o=>o.name===text);
    if(!option)throw new InterviewError(`Notionの「${property.name}」に対応する選択肢がありません。`,503);
    return {[property.type]:property.type==='select'?{id:option.id}:[{id:option.id}]};
  }
  throw new InterviewError(`Notionの「${property.name}」の項目形式を確認してください。`,503);
}
export function bookingProperties(booking,schema){
  const p=scheduleSchema(schema),d=booking.data;
  const mode=d.method==='Zoom'?'オンライン':d.method==='ハイブリッド'?'オンライン':d.method==='電話'?'電話':'対面';
  const marker=['cancelled','rejected'].includes(booking.status)?'【取消】':'';
  const result={
    [p.title.id]:value(p.title,`${marker}面談：${d.studentName}（${mode}）`),
    [p.date.id]:{date:{start:`${d.date}T${d.start}:00+09:00`,end:`${d.date}T${d.end}:00+09:00`}},
    [p.teacher.id]:value(p.teacher,d.teacher),[p.campus.id]:value(p.campus,d.campus),
    [p.content.id]:value(p.content,`面談(${mode})`),
    [p.booking.id]:value(p.booking,booking.id),[p.student.id]:value(p.student,d.studentId),
  };
  if(p.room&&d.room)result[p.room.id]=value(p.room,d.room);
  // Only schedule metadata is transferred. Private notes and draft records never leave Bentan.
  return result;
}
export function remoteSchedule(page,schema){
 const p=scheduleSchema(schema);
 const byId=Object.values(page.properties??{});
 const property=definition=>byId.find(v=>v.id===definition.id);
 return {bookingId:plain(property(p.booking)),date:property(p.date)?.date??null,
   archived:!!(page.archived||page.in_trash),editedAt:page.last_edited_time};
}
export async function syncBookingToNotion({booking,sourceId,request}){
 const schema=await request(`/data_sources/${sourceId}`);
 const properties=bookingProperties(booking,schema);
 if(!booking.notion_page_id){
   const matches=await request(`/data_sources/${sourceId}/query`,{method:'POST',body:JSON.stringify({filter:{property:scheduleSchema(schema).booking.id,rich_text:{equals:booking.id}},page_size:2})});
   if(matches.results.length>1||matches.has_more)throw new InterviewError('同じ予約IDのNotionカードが複数あります。内容を確認してください。',409);
   if(matches.results.length===1)return {status:'review',pageId:matches.results[0].id,message:'同じ予約IDのカードが見つかりました。紐づけ内容を確認してください。'};
   if(booking.sync_error==='create_uncertain')throw new InterviewError('前回のNotion登録結果を確認できません。再作成せずカードの有無を確認してください。',409);
   try{
    const page=await request('/pages',{method:'POST',body:JSON.stringify({parent:{type:'data_source_id',data_source_id:sourceId},properties})});
    return {status:'synced',pageId:page.id,editedAt:page.last_edited_time};
   }catch{ return {status:'uncertain',message:'Notionの登録結果を確認できません。重複を防ぐため再作成を停止しました。'}; }
 }
 const page=await request(`/pages/${booking.notion_page_id}`);
 const remote=remoteSchedule(page,schema);
 if(remote.archived)return {status:'review',message:'Notion側で削除されています。勉たんの予約は保持しています。'};
 if(remote.bookingId!==booking.id||remote.editedAt!==booking.notion_edited_at)return {status:'review',message:'Notion側で変更されています。上書きせず差分確認を待っています。'};
 const updated=await request(`/pages/${booking.notion_page_id}`,{method:'PATCH',body:JSON.stringify({properties})});
 return {status:'synced',pageId:updated.id,editedAt:updated.last_edited_time};
}
