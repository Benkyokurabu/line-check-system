import type {SupabaseClient} from '@supabase/supabase-js';
import {loadMaterialStudents} from './interview-material-students';
import {loadInvitationSurveyResponses,loadVerifiedSurveyAnswer} from './interview-surveys-notion';
import {notionRequest} from './notion';
import {InterviewError} from './interview-core.mjs';
import {isEnrollmentId,propertyText,sameNotionId} from './enrollment-core.mjs';
import {surveyLineRecipients} from './survey-line-recipients.mjs';
import {methodFromSurveySchedule} from './survey-schedule-style.mjs';
import {interviewDateParts} from './survey-workflow-core.mjs';
import {postAnswerRows} from './post-interview-core.mjs';
export const postRead=(path:string,init:RequestInit={})=>notionRequest(path,{...init,cache:'no-store',signal:AbortSignal.timeout(10000)});
export async function postAnswerOptions(db:SupabaseClient,query=''){
 const roster=await loadMaterialStudents(db),survey=await loadInvitationSurveyResponses(roster);
 return postAnswerRows(survey.rows,roster,query);
}
export async function verifiedPostAnswer(db:SupabaseClient,answerId:string){
 if(!isEnrollmentId(answerId))throw new InterviewError('アンケートを選び直してください。',422);
 const roster=await loadMaterialStudents(db),survey=await loadInvitationSurveyResponses(roster);
 const row=survey.rows.find(r=>sameNotionId(r.page_id,answerId)&&r.link_status==='linked');
 const student=row&&roster.find(s=>String(s.student_number)===String(row.student_number));if(!student)throw new InterviewError('回答と生徒の対応を確認できません。',409);
 await loadVerifiedSurveyAnswer(answerId,student,roster);
 const answer=await postRead('/pages/'+answerId);if(answer.archived||answer.in_trash)throw new InterviewError('回答は削除されています。',409);
 const relation=answer.properties['生徒情報DB']?.relation??[];if(relation.length>1)throw new InterviewError('回答の生徒が複数です。原本を確認してください。',409);
 let profileId=relation[0]?.id;
 if(!profileId){const mapping=await db.from('student_registry').select('notion_page_id').eq('student_number',student.student_number).eq('enrollment_status','current_roster').maybeSingle();if(mapping.error)throw new InterviewError('生徒の対応表を確認できません。',503);profileId=mapping.data?.notion_page_id;}
 if(!isEnrollmentId(profileId))throw new InterviewError('Notionの生徒情報を紐づけてください。',409);
 const profile=await postRead('/pages/'+profileId);
 if(profile.archived||profile.in_trash||!sameNotionId(profile.parent?.data_source_id,'19ef0120-80a7-80b7-9f23-000b21e0a53b')||propertyText(profile.properties['学籍番号'])!==String(student.student_number))throw new InterviewError('生徒番号とNotionの対応が一致しません。',409);
 const link=await db.from('survey_bensuke_links').select('baseline').eq('answer_id',answerId).maybeSingle();
 return {answer,profile,student,method:!link.error?methodFromSurveySchedule(link.data?.baseline):'',date:interviewDateParts(answer.properties['面談日']?.date?.start??'').date};
}
export async function postRecipients(db:SupabaseClient,number:string){
 const accounts=await db.from('student_line_accounts').select('student_number,line_user_id,relation,alias_name,friend_display_name,verification_status').eq('student_number',number).limit(1000);
 if(accounts.error||accounts.data.length>=1000)throw new InterviewError('送信先を全件確認できません。',503);
 const ids=accounts.data.map(a=>a.line_user_id);const aliases=ids.length?await db.from('line_user_aliases').select('line_user_id,alias_name').in('line_user_id',ids):{data:[],error:null};
 if(aliases.error)throw new InterviewError('LINEの登録名を確認できません。',503);
 return surveyLineRecipients(number,accounts.data,[],aliases.data??[]);
}
