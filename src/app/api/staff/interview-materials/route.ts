import { NextRequest } from 'next/server';
import { staffContext, staffResponse, staffErrorResponse } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';
import { loadInterviewState } from '@/lib/interview-store';
import { loadInvitationSurveyResponses } from '@/lib/interview-surveys-notion';
import { schoolsFromAnswer } from '@/lib/interview-material-schools.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('職員の権限を確認してください。', 403);
    const state = await loadInterviewState(context.dataClient);
    const survey = await loadInvitationSurveyResponses(state.students);
    const byNumber = new Map<string, Array<{ id: string; date: string; schools: string[]; fields: unknown[]; url: string }>>();
    for (const row of survey.rows) {
      if (row.link_status !== 'linked' || !row.student_number || !row.page_id) continue;
      const number = String(row.student_number);
      const fields = Array.isArray(row.answer_fields) ? row.answer_fields as Array<{ label: string; value: string }> : [];
      const responses = byNumber.get(number) ?? [];
      responses.push({ id: String(row.page_id), date: String(row.answered_at ?? ''), schools: schoolsFromAnswer(fields), fields, url: String(row.notion_url ?? '') });
      byNumber.set(number, responses);
    }
    const students = state.students.filter(s => s.enrollment_status === 'current_roster' && /^(小[4-6]|中[1-3])$/.test(String(s.grade ?? ''))).map(s => ({
      number: String(s.student_number ?? ''), name: String(s.student_name ?? ''), grade: String(s.grade ?? ''),
      teacher: String(s.homeroom_teacher ?? ''),
      responses: (byNumber.get(String(s.student_number ?? '')) ?? []).sort((a, b) => b.date.localeCompare(a.date)),
    }));
    return staffResponse({ campaign: '2026年 秋の面談アンケート', students, unmatched: survey.unmatched }, context);
  } catch (error) {
    return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context);
  }
}
