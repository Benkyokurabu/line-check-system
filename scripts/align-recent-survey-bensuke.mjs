import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {saveSurveySchedule,surveyScheduleValue,sameSurveySchedule} from '../src/lib/survey-bensuke.mjs';
import {interviewDateParts} from '../src/lib/survey-workflow-core.mjs';
import {suggestedInterviewEnd,methodFromSurveySchedule} from '../src/lib/survey-schedule-style.mjs';
import {BENSUKE_SOURCE} from '../src/lib/bensuke-booking.mjs';
import {academicGrade} from '../src/lib/student-academic-grade.mjs';
import {surveyMeetingCampus} from '../src/lib/survey-meeting-campus.mjs';
process.loadEnvFile(process.argv[process.argv.indexOf('--env')+1]);
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const request=async(path,init={})=>{const r=await fetch(`https://api.notion.com/v1${path}`,{...init,headers:{Authorization:`Bearer ${process.env.NOTION_TOKEN??process.env.NOTION_API_KEY}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`Notion request failed (${r.status})`);return r.json();};
const links=await db.from('survey_bensuke_links').select('*').not('page_id','is',null).order('updated_at',{ascending:false}).limit(1);if(links.error||links.data.length!==1)throw Error('直近のアンケート連携予定を特定できません。');
const link=links.data[0],answer=await request(`/pages/${link.answer_id}`),page=await request(`/pages/${link.page_id}`);
if(page.parent?.data_source_id!==BENSUKE_SOURCE||page.archived||page.in_trash||!sameSurveySchedule(surveyScheduleValue(page),link.baseline))throw Error('直近のベンスケ予定に別の変更があります。');
const prop=answer.properties['学籍番号'];
const number=String(prop?.number??(prop?.rich_text??prop?.title??[]).map(t=>t.plain_text??t.text?.content??'').join(''));
if(!number)throw Error('アンケートの学籍番号を確認できません。');
const roster=await db.from('student_registry').select('student_number,student_name,grade,homeroom_teacher,campus,enrollment_status').eq('student_number',number).eq('enrollment_status','current_roster').single();if(roster.error)throw Error('学籍番号に一致する生徒台帳を確認できません。');
const student={...roster.data,grade:academicGrade(number,new Date())??roster.data.grade};
const profileId=answer.properties['生徒情報DB']?.relation?.[0]?.id;
if(profileId){const profile=await request(`/pages/${profileId}`),p=profile.properties['学籍番号'];if(String(p?.number??(p?.rich_text??p?.title??[]).map(t=>t.plain_text??t.text?.content??'').join(''))!==number)throw Error('生徒情報DBの学籍番号が一致しません。');}
const {date,time}=interviewDateParts(answer.properties['面談日']?.date?.start??'');
if(date!==interviewDateParts(page.properties['日時']?.date?.start??'').date||time!==interviewDateParts(page.properties['日時']?.date?.start??'').time)throw Error('アンケートとベンスケの日時が一致しません。');
const method=methodFromSurveySchedule(link.baseline)||'３者Zoom';
const endTime=interviewDateParts(page.properties['日時']?.date?.end??'').time||suggestedInterviewEnd(time,student.homeroom_teacher);
fs.mkdirSync('analysis_outputs/survey-save-line-style',{recursive:true});fs.writeFileSync(`analysis_outputs/survey-save-line-style/notion-before-${Date.now()}.json`,JSON.stringify({link,answer,page,student}));
if(!process.argv.includes('--apply')){console.log(JSON.stringify({preview:true,targetCount:1,date,time,endTime,method,format:'学年＋氏名／三者面談',backupCreated:true}));process.exit(0);}
const result=await saveSurveySchedule({request,answer,student,date,time,endTime,method,expectedEditedAt:answer.last_edited_time,
 claim:async(id)=>{const r=await db.rpc('survey_bensuke_claim',{p_answer:id});if(r.error)throw Error('保存の排他を開始できません。');return r.data;},
 store:async(id,lease,value,release)=>{const r=await db.rpc('survey_bensuke_store',{p_answer:id,p_lease:lease,p_value:value,p_release:release});if(r.error)throw Error('更新結果を保存できません。');},
 reserve:async(id,lease,pageId)=>{const r=await db.rpc('survey_bensuke_reserve',{p_answer:id,p_lease:lease,p_page:pageId});if(r.error)throw Error('予約可の枠を確保できません。');},
 resolveCampus:(date,teacher)=>surveyMeetingCampus(db,date,teacher),
});
const after=await request(`/pages/${result.bensuke.id}`),row=await db.from('survey_bensuke_links').select('page_id,state,baseline').eq('answer_id',answer.id).single();
if(row.error||row.data.page_id!==result.bensuke.id||row.data.state!=='synced'||after.archived||after.in_trash||!sameSurveySchedule(surveyScheduleValue(after),row.data.baseline))throw Error('更新結果の検証に失敗しました。');
if(result.bensuke.id!==page.id){const previous=await request(`/pages/${page.id}`);if(!previous.archived&&!previous.in_trash)throw Error('付け替え前の面談の整理を確認できません。');}
fs.writeFileSync(`analysis_outputs/survey-save-line-style/notion-after-${Date.now()}.json`,JSON.stringify({page:after,link:row.data}));
console.log(JSON.stringify({applied:result.ok,targetCount:1,samePageUpdated:result.bensuke.id===page.id,originalAvailabilityUsed:result.bensuke.id!==page.id,notionAndSavedStateVerified:true,date,time,endTime,method,lineSent:false}));
