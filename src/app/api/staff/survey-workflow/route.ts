import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,assertStaffMutationOrigin,staffJsonBody} from '@/lib/staff-auth-http';
import {InterviewError} from '@/lib/interview-core.mjs';
import {loadMaterialStudents} from '@/lib/interview-material-students';
import {loadInvitationSurveyResponses,loadVerifiedSurveyAnswer} from '@/lib/interview-surveys-notion';
import {notionRequest} from '@/lib/notion';
import {readLineResponse} from '@/lib/line-send-audit';
import {validInterviewDate,notionRecordText,interviewLineRetryKey,interviewDateParts,recordBlockState,RECORD_CAPTION} from '@/lib/survey-workflow-core.mjs';
import {saveSurveySchedule} from '@/lib/survey-bensuke.mjs';
import {surveyMeetingCampus} from '@/lib/survey-meeting-campus.mjs';
import {surveyLineRecipients} from '@/lib/survey-line-recipients.mjs';
import {methodFromSurveySchedule} from '@/lib/survey-schedule-style.mjs';

export const dynamic='force-dynamic';
export const maxDuration=60;
const RECORD_SOURCE='19ef0120-80a7-808a-8992-000b85713577';
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
type NotionText={plain_text?:string;text?:{content?:string}};
type NotionProperty={title?:NotionText[];rich_text?:NotionText[];number?:number|null;relation?:Array<{id:string}>;date?:{start?:string}|null};
type NotionPage={id:string;url?:string;last_edited_time?:string;parent?:{data_source_id?:string};properties:Record<string,NotionProperty>};
type RecordBlock={id:string;type:string;last_edited_time?:string;code?:{rich_text?:NotionText[];caption?:NotionText[]};has_children?:boolean;[key:string]:unknown};

type StaffContext=Awaited<ReturnType<typeof staffContext>>;

function text(property?:NotionProperty){return (property?.title??property?.rich_text??[]).map(x=>x.plain_text??x.text?.content??'').join('').trim();}
function requireRole(context:StaffContext){if(!['admin','office','employee','teacher'].includes(context.staff.role))throw new InterviewError('職員の権限を確認してください。',403);}

async function selectedAnswer(context:StaffContext,answerId:string){
 if(/^[a-f\d]{32}$/i.test(answerId))answerId=answerId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
 if(!UUID.test(answerId))throw new InterviewError('アンケート回答を選び直してください。',400);
 const roster=await loadMaterialStudents(context.dataClient);
 const survey=await loadInvitationSurveyResponses(roster);
 const row=survey.rows.find(x=>String(x.page_id??'').replaceAll('-','').toLowerCase()===answerId.replaceAll('-','').toLowerCase()&&x.link_status==='linked');
 const student=row&&roster.find(x=>String(x.student_number)===String(row.student_number));
 if(!student)throw new InterviewError('アンケート回答と生徒を照合できません。',404);
 const answer=await loadVerifiedSurveyAnswer(answerId,student,roster);
 const page=await notionRequest(`/pages/${answerId}`) as NotionPage;
 const relation=page.properties['生徒情報DB']?.relation??[];
 if(relation.length>1)throw new InterviewError('アンケートに複数の生徒情報が紐づいています。',409);
 let profileId=relation[0]?.id??'';
 if(!profileId){
  const {data:registered,error}=await context.dataClient.from('student_registry')
   .select('notion_page_id').eq('student_number',student.student_number).eq('enrollment_status','current_roster').maybeSingle();
  if(error)throw new InterviewError('Notionの生徒対応表を取得できません。',503);
  profileId=String(registered?.notion_page_id??'');
  if(!profileId){
   const {data:mapping,error:mappingError}=await context.dataClient.from('notion_student_profiles')
    .select('notion_page_id').eq('student_number',student.student_number).order('updated_at',{ascending:false}).limit(1).maybeSingle();
   if(mappingError)throw new InterviewError('Notionの生徒対応表を取得できません。',503);
   profileId=String(mapping?.notion_page_id??'');
  }
 }
 if(!profileId)throw new InterviewError('生徒情報のNotionページを確認できません。',409);
 const profile=await notionRequest(`/pages/${profileId}`) as NotionPage;
 if(text(profile.properties['学籍番号'])!==String(student.student_number)&&
    String(profile.properties['学籍番号']?.number??'')!==String(student.student_number))
   throw new InterviewError('Notionの生徒番号が一致しません。',409);
 return {student,page,profile,answer};
}
async function linkedAccounts(context:StaffContext,number:string){
 const [accounts,links]=await Promise.all([
  context.dataClient.from('student_line_accounts').select('student_number,line_user_id,relation,alias_name,friend_display_name,verification_status').eq('student_number',number).limit(1000),
  context.dataClient.from('student_line_links').select('student_number,line_user_id').eq('student_number',number).limit(1000),
 ]);
 if(accounts.error||links.error||accounts.data.length===1000||links.data.length===1000)throw new InterviewError('学籍番号に登録されたLINE宛先を取得できません。',503);
 const ids=[...new Set([...accounts.data,...links.data].map(x=>String(x.line_user_id)).filter(Boolean))];
 const aliases=ids.length?await context.dataClient.from('line_user_aliases').select('line_user_id,alias_name').in('line_user_id',ids):{data:[],error:null};
 if(aliases.error)throw new InterviewError('LINEの現在の登録名を取得できません。',503);
 return surveyLineRecipients(number,accounts.data,links.data,aliases.data??[]);
}
async function matchingRecord(profileId:string,date:string){
 const result=await notionRequest(`/data_sources/${RECORD_SOURCE}/query`,{method:'POST',body:JSON.stringify({
  page_size:10,filter:{and:[{property:'生徒情報DB',relation:{contains:profileId}},{property:'面談日',date:{equals:date}}]},
 })}) as {results?:NotionPage[];has_more?:boolean};
 if(result.has_more||(result.results??[]).length>1)throw new InterviewError('同じ日の面談記録が複数あります。Notionの原本を確認してください。',409);
 return result.results?.[0]??null;
}
async function recordDetails(profileId:string,date:string){
 const page=await matchingRecord(profileId,date);
 if(!page)return {id:'',url:'',body:'',blockId:'',blockEditedAt:'',editable:true};
 const blocks=await notionRequest(`/blocks/${page.id}/children?page_size=100`) as {results?:RecordBlock[];has_more?:boolean};
 return {id:page.id,url:page.url??`https://app.notion.com/p/${page.id.replaceAll('-','')}`,
  ...recordBlockState(blocks,page.last_edited_time)};
}
function responseError(error:unknown,context?:StaffContext){
 return error instanceof InterviewError?staffResponse({error:error.message},context,error.status):staffErrorResponse(error,context);
}
export async function GET(request:NextRequest){let context:StaffContext|undefined;try{
 context=await staffContext(request);requireRole(context);
 const answer=request.nextUrl.searchParams.get('answer')??'';
 const {student,page,profile,answer:verifiedAnswer}=await selectedAnswer(context,answer);
 const storedDate=page.properties['面談日']?.date?.start??'';
 const {date,time}=interviewDateParts(storedDate);
 const {data:link,error:linkError}=await context.dataClient.from('survey_bensuke_links').select('page_id,state,baseline').eq('answer_id',page.id).maybeSingle();
 const [accounts,record]=await Promise.all([linkedAccounts(context,String(student.student_number)),
  date?recordDetails(profile.id,date):Promise.resolve(null)]);
  const ids=accounts.map(account=>account.id);
 let history:unknown[]=[];let historyError='';
 if(ids.length){const {data:messages,error}=await context.dataClient.from('line_messages')
  .select('id,line_user_id,direction,text,received_at,sent_by').in('line_user_id',ids)
  .order('received_at',{ascending:false}).limit(20);
  if(!error)history=messages??[];else historyError='LINE履歴を取得できませんでした。最新情報を読み直してください。';
 }
 return staffResponse({student:{name:student.student_name,number:student.student_number,grade:student.grade},
  staffName:context.staff.displayName,
  survey:{id:page.id,url:page.url,date,time,editedAt:page.last_edited_time},
  bensuke:linkError?{state:'unavailable'}:{state:link?.state??'new',id:link?.page_id??'',url:link?.page_id?`https://www.notion.so/${String(link.page_id).replaceAll('-','')}`:'',
   method:methodFromSurveySchedule(link?.baseline),endTime:interviewDateParts(link?.baseline?.end??'').time,styled:!!link?.baseline?.title?.includes('／')},
  scheduleTeacher:student.homeroom_teacher,
  accounts,record,history,historyError,answerFields:verifiedAnswer.fields},context);
 }catch(error){return responseError(error,context);}}

export async function POST(request:NextRequest){let context:StaffContext|undefined;try{
 assertStaffMutationOrigin(request);context=await staffContext(request);requireRole(context);
 const body=await staffJsonBody(request,30000);
 const {student,page,profile}=await selectedAnswer(context,String(body.answerId??''));
 const storedDate=page.properties['面談日']?.date?.start??'';
 const {date}=interviewDateParts(storedDate);
 if(body.action==='date'){
  if(body.time!==undefined&&typeof body.time!=='string')throw new InterviewError('開始時刻を確認してください。',400);
  if(body.endTime!==undefined&&typeof body.endTime!=='string')throw new InterviewError('終了時刻を確認してください。',400);
  if(body.method!==undefined&&typeof body.method!=='string')throw new InterviewError('面談方法を確認してください。',400);
  const result=await saveSurveySchedule({request:(path:string,init:RequestInit={})=>notionRequest(path,{...init,cache:'no-store',signal:AbortSignal.timeout(10000)}),
   answer:page,student,date:body.date,time:body.time??'',endTime:body.endTime??'',method:body.method??'３者Zoom',expectedEditedAt:String(body.expectedEditedAt??''),
   claim:async(id:string)=>{const r=await context!.dataClient.rpc('survey_bensuke_claim',{p_answer:id});if(r.error)throw new InterviewError(r.error.code==='PT409'?r.error.message:'ベンスケ連携の保存準備ができません。入力は保持しています。',r.error.code==='PT409'?409:503);return r.data;},
   store:async(id:string,lease:string,value:unknown,release:boolean)=>{const r=await context!.dataClient.rpc('survey_bensuke_store',{p_answer:id,p_lease:lease,p_value:value,p_release:release});if(r.error)throw new InterviewError('ベンスケの反映状態を保存できません。再試行で確認してください。',503);},
   reserve:async(id:string,lease:string,pageId:string)=>{const r=await context!.dataClient.rpc('survey_bensuke_reserve',{p_answer:id,p_lease:lease,p_page:pageId});if(r.error)throw new InterviewError(r.error.code==='PT409'?r.error.message:'予約可の保存準備ができません。入力は保持しています。',r.error.code==='PT409'?409:503);},
   resolveCampus:(date:string,teacher:string)=>surveyMeetingCampus(context!.dataClient,date,teacher),
  });
  return staffResponse(result,context);
 }
 if(['record','send'].includes(String(body.action))&&String(body.expectedSurveyEditedAt??'')!==page.last_edited_time)throw new InterviewError('アンケートの日程が更新されています。最新情報を読み直して確認してください。',409);
 if(body.action==='record'){
  if(!validInterviewDate(date))throw new InterviewError('先にアンケートの面談日を保存してください。',409);
  const content=String(body.content??'').trim();
  if(!content||content.length>15000)throw new InterviewError('面談記録の本文を確認してください。',400);
  const current=await recordDetails(profile.id,date);
  if(!current.editable)throw new InterviewError('記録が大きいか編集用ブロックが重複しています。原本を確認してください。',409);
  if(current.id){
   if(String(body.expectedBlockId??'')!==current.blockId||String(body.expectedBlockEditedAt??'')!==current.blockEditedAt)
    throw new InterviewError('面談記録が更新されています。読み込み直して確認してください。',409);
   if(current.blockId)await notionRequest(`/blocks/${current.blockId}`,{method:'PATCH',body:JSON.stringify({code:{rich_text:notionRecordText(content),language:'plain text'}})});
   else await notionRequest(`/blocks/${current.id}/children`,{method:'PATCH',body:JSON.stringify({children:[{object:'block',type:'code',code:{rich_text:notionRecordText(content),language:'plain text',caption:[{type:'text',text:{content:RECORD_CAPTION}}]}}]})});
   return staffResponse({ok:true,recordId:current.id},context);
  }
  const method=String(body.method??'');
  if(method&&!['電話','LINE','2者Zoom','３者Zoom','２者対面','３者対面','４者Zoom','４者対面','メール','会議','合同手続会'].includes(method))
   throw new InterviewError('面談方法を確認してください。',400);
  const grade=String(student.grade??'').normalize('NFKC').replace(/(\d)/g,(_,n)=>String.fromCharCode(n.charCodeAt(0)+0xFEE0));
  const properties:Record<string,unknown>={
   '面談内容':{title:[{text:{content:`${grade}秋の教育相談会`}}]},
   '面談日':{date:{start:date}},
   '生徒情報DB':{relation:[{id:profile.id}]},
   '面談時の学年':{select:{name:grade}},
   '面談目的':{multi_select:[{name:'秋の教育相談会'}]},
  };
  if(method)properties['方法']={select:{name:method}};
  const created=await notionRequest('/pages',{method:'POST',body:JSON.stringify({
   parent:{type:'data_source_id',data_source_id:RECORD_SOURCE},properties,
   children:[{object:'block',type:'code',code:{rich_text:notionRecordText(content),language:'plain text',caption:[{type:'text',text:{content:RECORD_CAPTION}}]}}],
  })}) as {id:string};
  return staffResponse({ok:true,recordId:created.id},context);
 }
 if(body.action==='send'){
  const phase=String(body.phase??'');
  if(!['schedule','summary'].includes(phase))throw new InterviewError('連絡の種類を確認してください。',400);
  if(phase==='summary'&&(!validInterviewDate(date)||!(await matchingRecord(profile.id,date))))throw new InterviewError('先に面談記録を保存してください。',409);
  const messages=body.messages;
  if(!Array.isArray(messages)||messages.length<1||messages.length>10)throw new InterviewError('送信先を選んでください。',400);
  const accounts=await linkedAccounts(context,String(student.student_number));
  const allowed=new Set(accounts.map(x=>x.id));const seen=new Set<string>();
  for(const item of messages){
   if(!item||typeof item!=='object'||!allowed.has(item.lineUserId)||seen.has(item.lineUserId)
      ||typeof item.text!=='string'||!item.text.trim()||item.text.length>5000)
    throw new InterviewError('宛先または文面を確認してください。',400);
   seen.add(item.lineUserId);
  }
  const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if(!token)throw new InterviewError('LINE送信の設定を確認してください。',503);
  const results=[];
  for(const item of messages){
   const key=interviewLineRetryKey(page.id,phase,item.lineUserId,item.text.trim());
   const id=`out_survey_${key}`;
   const {data:prior,error:checkError}=await context.dataClient.from('line_messages').select('id').eq('line_message_id',id).maybeSingle();
   if(checkError)throw new InterviewError('送信履歴を確認できません。再送せず履歴を確認してください。',503);
   if(prior){results.push({lineUserId:item.lineUserId,status:'already_sent'});continue;}
   try{
    const line=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{
     'Content-Type':'application/json',Authorization:`Bearer ${token}`,'X-Line-Retry-Key':key,
    },body:JSON.stringify({to:item.lineUserId,messages:[{type:'text',text:item.text.trim()}]})});
    const accepted=line.ok||line.status===409&&!!line.headers.get('x-line-accepted-request-id');
    const response=await readLineResponse(line);
    if(!accepted){results.push({lineUserId:item.lineUserId,status:'failed',detail:'LINEが送信を受け付けませんでした。'});continue;}
    const {error:saveError}=await context.dataClient.from('line_messages').insert({
     line_message_id:id,line_user_id:item.lineUserId,direction:'outbound',message_type:'text',
     text:item.text.trim(),sent_by:context.staff.displayName,received_at:new Date().toISOString(),
     raw_event:{operation:'interview_survey_workflow',phase,survey_page_id:page.id,student_number:student.student_number,
      line_retry_key:key,line_request_id:line.headers.get('x-line-accepted-request-id')??line.headers.get('x-line-request-id'),
      line_http_status:line.status,line_response:response},
    });
    if(saveError){
     const {data:concurrent}=await context.dataClient.from('line_messages').select('id').eq('line_message_id',id).maybeSingle();
     results.push({lineUserId:item.lineUserId,status:concurrent?'already_sent':'history_failed'});
    }else results.push({lineUserId:item.lineUserId,status:'sent'});
   }catch{
    results.push({lineUserId:item.lineUserId,status:'unknown',detail:'送信結果を確認できません。再送せずLINE履歴を確認してください。'});
   }
  }
  return staffResponse({results},context);
 }
 throw new InterviewError('操作を確認してください。',400);
 }catch(error){return responseError(error,context);}}
