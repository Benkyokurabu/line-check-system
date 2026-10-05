import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {saveSurveySchedule,surveyScheduleValue,sameSurveySchedule} from '../src/lib/survey-bensuke.mjs';
import {matchingSurveyAvailability} from '../src/lib/survey-bensuke-availability.mjs';
import {interviewDateParts} from '../src/lib/survey-workflow-core.mjs';
import {methodFromSurveySchedule} from '../src/lib/survey-schedule-style.mjs';
import {surveyMeetingCampus} from '../src/lib/survey-meeting-campus.mjs';
process.loadEnvFile(process.argv.includes('--env')?process.argv[process.argv.indexOf('--env')+1]:'../../.env.local');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const request=async(path,init={})=>{const r=await fetch(`https://api.notion.com/v1${path}`,{...init,headers:{Authorization:`Bearer ${process.env.NOTION_TOKEN??process.env.NOTION_API_KEY}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`Notion request failed (${r.status})`);return r.json();};
const links=await db.from('survey_bensuke_links').select('*').not('page_id','is',null).limit(101);if(links.error||links.data.length>100)throw Error('対象の連携予定を全件確認できません。');
const candidates=[];let deletedAppointments=0;
for(const link of links.data){
 const page=await request(`/pages/${link.page_id}`),value=surveyScheduleValue(page);
 if(page.archived||page.in_trash){deletedAppointments++;continue;}
 const slot=await matchingSurveyAvailability(request,value,page.id);if(!slot)continue;
 if(!sameSurveySchedule(value,link.baseline)||link.state!=='synced')throw Error('連携済み予定に未反映または原本の変更があります。');
 const answer=await request(`/pages/${link.answer_id}`),{date,time}=interviewDateParts(answer.properties['面談日']?.date?.start??'');
 if(!time||Date.parse(`${date}T${time}:00+09:00`)!==Date.parse(value.start))throw Error('アンケートと面談の日時が一致しません。');
 const p=answer.properties['学籍番号'],number=String(p?.number??(p?.rich_text??p?.title??[]).map(t=>t.plain_text??t.text?.content??'').join(''));
 const roster=await db.from('student_registry').select('student_number,student_name,grade,homeroom_teacher,campus').eq('student_number',number).eq('enrollment_status','current_roster').single();if(roster.error||!number)throw Error('対象生徒を台帳で確認できません。');
 const method=methodFromSurveySchedule(value);if(!method)throw Error('保存済み面談方法を確認できません。');
 candidates.push({link,page,slot,answer,student:roster.data,date,time,endTime:interviewDateParts(value.end??'').time,method});
}
fs.mkdirSync('analysis_outputs/survey-bensuke-availability',{recursive:true});
const snapshot=`analysis_outputs/survey-bensuke-availability/reconcile-${Date.now()}`;
fs.writeFileSync(`${snapshot}-before.json`,JSON.stringify(candidates));
console.log(JSON.stringify({preview:true,targetCount:candidates.length,deletedAppointmentsSkipped:deletedAppointments,dates:candidates.map(c=>({date:c.date,time:c.time})),backupCreated:true}));
if(!process.argv.includes('--apply'))process.exit(0);
const rpc=async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw Error(`State save failed (${r.error.code})`);return r.data;};
const results=[];
for(const c of candidates){
 const result=await saveSurveySchedule({...c,request,expectedEditedAt:c.answer.last_edited_time,
  claim:id=>rpc('survey_bensuke_claim',{p_answer:id}),store:(id,lease,value,release)=>rpc('survey_bensuke_store',{p_answer:id,p_lease:lease,p_value:value,p_release:release}),
  reserve:(id,lease,pageId)=>rpc('survey_bensuke_reserve',{p_answer:id,p_lease:lease,p_page:pageId}),
  resolveCampus:(date,teacher)=>surveyMeetingCampus(db,date,teacher),
 });
 const page=await request(`/pages/${c.page.id}`),slot=await request(`/pages/${c.slot.page.id}`),row=await db.from('survey_bensuke_links').select('*').eq('answer_id',c.answer.id).single();
 if(result.bensuke.id!==c.slot.page.id||row.error||row.data.page_id!==c.slot.page.id||row.data.state!=='synced'||slot.archived||slot.in_trash||!sameSurveySchedule(surveyScheduleValue(slot),row.data.baseline)||!page.archived&&!page.in_trash)throw Error('重複解消の結果を確認できません。');
 const extras=[];
 for(const duplicate of c.slot.duplicates){const extra=await request(`/pages/${duplicate.page.id}`);if(!extra.archived&&!extra.in_trash)throw Error('追加の重複枠を解消できません。');extras.push(extra);}
 results.push({page,slot,extras,link:row.data});
}
fs.writeFileSync(`${snapshot}-after.json`,JSON.stringify(results));
console.log(JSON.stringify({applied:true,targetCount:results.length,availabilityUrlsPreserved:true,availabilityConsumed:true,extraAppointmentsArchived:true,lineSent:false}));
