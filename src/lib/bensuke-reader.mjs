import {InterviewError} from './interview-core.mjs';

const text = items => (items??[]).map(x=>x.plain_text??x.text?.content??'').join('');
const uuid = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const nameOf = schema => text(schema.title);
const normalize = name => name.normalize('NFKC').replace(/[\s　]/g,'').replace(/DB$/i,'');

// Read existing cards without requiring Bentan-specific properties or changing Notion.
export function bensukeSchema(schema){
 const properties=Object.entries(schema.properties??{}).map(([name,p])=>({...p,name:p.name??name}));
 const title=properties.find(p=>p.type==='title');
 const date=properties.find(p=>p.name==='日時'&&p.type==='date');
 if(!title||!date)throw new InterviewError('ベンスケの名前・日時の項目を確認できません。予定の取得を停止しました。',503);
 return {title,date,fields:properties.filter(p=>['担当者','校舎','教室','内容','メンション'].includes(p.name))};
}

function display(property){
 if(!property)return '';
 switch(property.type){
  case 'title':return text(property.title);
  case 'rich_text':return text(property.rich_text);
  case 'select':return property.select?.name??'';
  case 'status':return property.status?.name??'';
  case 'multi_select':return property.multi_select.map(x=>x.name).join('、');
  case 'people':return property.people.map(x=>x.name??'Notionで確認').join('、');
  case 'number':return property.number==null?'':String(property.number);
  case 'relation':return property.relation.length?'Notionで確認':'';
  default:return 'Notionで確認';
 }
}

export async function findBensukeSource(request,sourceId){
 if(sourceId){
  if(!uuid.test(sourceId))throw new InterviewError('ベンスケの接続先の設定を確認してください。',503);
  return request(`/data_sources/${sourceId}`);
 }
 const matches=new Map();let cursor;const cursors=new Set();
 do{
  const page=await request('/search',{method:'POST',body:JSON.stringify({query:'ベンスケ',filter:{property:'object',value:'data_source'},page_size:100,...(cursor?{start_cursor:cursor}:{})})});
  for(const row of page.results??[])if(normalize(nameOf(row))==='ベンスケ')matches.set(row.id,row);
  if(page.has_more&&(!page.next_cursor||cursors.has(page.next_cursor)))throw new InterviewError('ベンスケの検索を完了できませんでした。再取得してください。',503);
  cursor=page.has_more?page.next_cursor:null;if(cursor)cursors.add(cursor);
  if(cursors.size>10)throw new InterviewError('ベンスケの接続先を特定できませんでした。',503);
 }while(cursor);
 if(matches.size===0)throw new InterviewError('ベンスケを読み取れません。NotionでベンスケDBを開き、右上の「•••」→「コネクト」で「塾業務システム連携」の接続を確認してください。',503);
 if(matches.size!==1)throw new InterviewError('同名のベンスケが複数あります。接続先を特定するまで取得を停止しています。',503);
 const id=[...matches.keys()][0];
 if(!uuid.test(id))throw new InterviewError('ベンスケの接続先を確認できません。',503);
 return request(`/data_sources/${id}`);
}

export async function readBensukeDay({request,sourceId,date}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new InterviewError('日付を確認してください。');
 const schema=await findBensukeSource(request,sourceId);
 if(!uuid.test(schema.id))throw new InterviewError('ベンスケの接続先を確認できません。',503);
 const p=bensukeSchema(schema),rows=[];let cursor;const cursors=new Set();
 do{
  const page=await request(`/data_sources/${schema.id}/query`,{method:'POST',body:JSON.stringify({filter:{property:p.date.id,date:{equals:date}},sorts:[{property:p.date.id,direction:'ascending'}],page_size:100,...(cursor?{start_cursor:cursor}:{})})});
  for(const row of page.results??[]){
   if(row.archived||row.in_trash)continue;
   const values=Object.values(row.properties??{}),get=definition=>values.find(v=>v.id===definition.id);
   if(!uuid.test(row.id))throw new InterviewError('ベンスケの予定を確認できませんでした。',503);
   rows.push({id:row.id,title:display(get(p.title)),date:get(p.date)?.date??null,url:`https://www.notion.so/${row.id.replaceAll('-','')}`,fields:p.fields.map(field=>({name:field.name,value:display(get(field))})),editedAt:row.last_edited_time});
  }
  if(page.has_more&&(!page.next_cursor||cursors.has(page.next_cursor)))throw new InterviewError('予定の取得が途中で停止しました。再取得してください。',503);
  cursor=page.has_more?page.next_cursor:null;if(cursor)cursors.add(cursor);
  if(cursors.size>=10)throw new InterviewError('予定が多いため全件取得できませんでした。Notionで確認してください。',503);
 }while(cursor);
 return {title:nameOf(schema),date,rows,checkedAt:new Date().toISOString(),readOnly:true};
}
