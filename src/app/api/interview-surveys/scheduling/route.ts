import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
import {readAll} from '@/lib/interview-store';
import {loadInvitationSurveyResponses} from '@/lib/interview-surveys-notion';
import {withAcademicGrade} from '@/lib/student-academic-grade.mjs';
import {surveyScheduling} from '@/lib/survey-scheduling.mjs';
export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request:NextRequest){let context;try{
 context=await staffContext(request);const db=context.dataClient;
 const [roster,identities,invitations,requests,bookings]=await Promise.all([
  readAll(db,'student_registry'),readAll(db,'interview_students'),readAll(db,'interview_invitations'),readAll(db,'interview_parent_requests'),readAll(db,'interview_bookings'),
 ]);
 const students=roster.map(s=>withAcademicGrade(s));
 const survey=await loadInvitationSurveyResponses(students);
 const states:Record<string,ReturnType<typeof surveyScheduling>>={};
 for(const row of survey.rows){
  if(!row.page_id)continue;const pageId=String(row.page_id).replaceAll('-','').toLowerCase();
  const student=row.link_status==='linked'?students.find(s=>s.student_number===row.student_number):undefined;
  const identity=student&&identities.find(i=>i.id===student.interview_student_id&&!i.retired_at);
  states[pageId]=surveyScheduling(identity?.id,invitations,requests,bookings);
 }
 return staffResponse({states,updatedAt:new Date().toISOString()},context);
 }catch(e){return staffErrorResponse(e,context);}}
