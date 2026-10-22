import {InterviewError} from './interview-core.mjs';

const DEFAULT_SOURCE='19ef0120-80a7-80b7-9f23-000b21e0a53b';
function studentNumber(page){
 const property=page?.properties?.['学籍番号'];
 return property?.number!=null?String(property.number):
  (property?.title??property?.rich_text??[]).map(x=>x.plain_text??x.text?.content??'').join('').trim();
}

/** Resolve missing local mappings from the Notion original; never guess by name or write back. */
export async function resolveSurveyStudentProfile({db,request,page,number,source=process.env.NOTION_STUDENT_DATA_SOURCE_ID?.trim()||DEFAULT_SOURCE}){
 const relation=page.properties['生徒情報DB']?.relation??[];
 if(relation.length>1)throw new InterviewError('アンケートに複数の生徒情報が紐づいています。',409);
 let profileId=relation[0]?.id??'';
 if(!profileId){
  const {data:registered,error}=await db.from('student_registry')
   .select('notion_page_id').eq('student_number',number).eq('enrollment_status','current_roster').maybeSingle();
  if(error)throw new InterviewError('Notionの生徒対応表を取得できません。',503);
  profileId=String(registered?.notion_page_id??'');
  if(!profileId){
   const {data:mapping,error:mappingError}=await db.from('notion_student_profiles')
    .select('notion_page_id').eq('student_number',number).order('updated_at',{ascending:false}).limit(1).maybeSingle();
   if(mappingError)throw new InterviewError('Notionの生徒対応表を取得できません。',503);
   profileId=String(mapping?.notion_page_id??'');
  }
 }
 let profile;
 if(profileId)profile=await request(`/pages/${profileId}`);
 else {
  if(!/^\d+$/.test(String(number))||!Number.isSafeInteger(Number(number)))
   throw new InterviewError('生徒の学籍番号を確認してください。',409);
  const result=await request(`/data_sources/${source}/query`,{method:'POST',body:JSON.stringify({
   page_size:2,filter:{and:[{property:'学籍番号',number:{equals:Number(number)}},{property:'状態',select:{equals:'在塾'}}]},
  })});
  if(!Array.isArray(result.results))throw new InterviewError('Notionの生徒情報を取得できません。',503);
  if(result.has_more||result.results.length>1)
   throw new InterviewError('同じ学籍番号のNotion生徒情報が複数あります。原本を確認してください。',409);
  profile=result.results[0];
 }
 if(!profile||profile.archived||profile.in_trash)throw new InterviewError('生徒情報のNotionページを確認できません。',409);
 if(studentNumber(profile)!==String(number))throw new InterviewError('Notionの生徒番号が一致しません。',409);
 return profile;
}
