import {cloudInterviewSummary,interviewSummaryEngine} from '@/lib/interview-info-cloud.mjs';
import { NextRequest } from 'next/server';
import { assertStaffMutationOrigin, staffContext, staffResponse, staffErrorResponse, staffJsonBody } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('職員の権限を確認してください。', 403);
    const number = request.nextUrl.searchParams.get('number') ?? '';
    if (!/^\d{5,12}$/.test(number)) throw new InterviewError('生徒番号を確認してください。', 400);
    const { data: student, error: rosterError } = await context.dataClient.from('student_registry')
      .select('student_number').eq('student_number', number).eq('enrollment_status', 'current_roster').maybeSingle();
    if (rosterError) throw new InterviewError('生徒台帳を取得できません。', 503);
    if (!student) throw new InterviewError('在籍生徒が見つかりません。', 404);
    const { data, error } = await context.dataClient.from('interview_material_info_summaries')
      .select('source_hash,status,requested,result').eq('student_number', number).maybeSingle();
    if (error) throw new InterviewError('情報の要約を取得できません。', 503);
    return staffResponse({ execution: interviewSummaryEngine(), summary: data ? { sourceHash: data.source_hash,
      status: data.status === 'queued' && !data.requested ? 'prepared' : data.status,
      items: Array.isArray(data.result) ? data.result : [] } : { status: 'empty', items: [] } }, context);
  } catch (error) {
    return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context);
  }
}

export async function POST(request: NextRequest) {
  let context;
  try {
    assertStaffMutationOrigin(request);
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('職員の権限を確認してください。', 403);
    const body = await staffJsonBody(request);
    const number = String(body.number ?? '');
    if (!/^\d{5,12}$/.test(number)) throw new InterviewError('生徒番号を確認してください。', 400);
    const { data: student, error: rosterError } = await context.dataClient.from('student_registry')
      .select('student_number').eq('student_number', number).eq('enrollment_status', 'current_roster').maybeSingle();
    if (rosterError) throw new InterviewError('生徒台帳を取得できません。', 503);
    if (!student) throw new InterviewError('在籍生徒が見つかりません。', 404);
    const { data: row, error: readError } = await context.dataClient.from('interview_material_info_summaries')
      .select('source_hash,status,requested,fields,attempts,claimed_at,updated_at').eq('student_number', number).maybeSingle();
    if (readError) throw new InterviewError('情報の要約を確認できません。', 503);
    if (!row) throw new InterviewError('生徒情報を先に読み込んでください。', 409);
    const engine = interviewSummaryEngine();
    if (row.status === 'completed' || row.status === 'running' && row.claimed_at
      && Date.parse(row.claimed_at) > Date.now() - 10 * 60_000)
      return staffResponse({ status: row.status, execution: engine }, context);
    if (engine === 'cloud') {
      const lease = new Date().toISOString();
      const {data: claimed,error: claimError} = await context.dataClient.from('interview_material_info_summaries')
        .update({status:'running',requested:false,attempts:1,claimed_at:lease,error:null,updated_at:lease})
        .eq('student_number',number).eq('source_hash',row.source_hash).eq('status',row.status).eq('updated_at',row.updated_at)
        .select('student_number').maybeSingle();
      if(claimError)throw new InterviewError('AI要約を開始できません。',503);
      if(!claimed)return staffResponse({status:'running',execution:engine},context);
      try {
        const result = await cloudInterviewSummary(row.fields,{key:process.env.GROQ_API_KEY,model:process.env.INTERVIEW_SUMMARY_MODEL || 'openai/gpt-oss-120b'});
        const {data: saved,error: saveError} = await context.dataClient.from('interview_material_info_summaries')
          .update({status:'completed',result,error:null,updated_at:new Date().toISOString()})
          .eq('student_number',number).eq('source_hash',row.source_hash).eq('claimed_at',lease).eq('status','running')
          .select('student_number').maybeSingle();
        if(saveError)throw new InterviewError('AI要約を保存できません。',503);
        if(!saved)return staffResponse({status:'prepared',execution:engine},context);
        return staffResponse({status:'completed',execution:engine},context);
      } catch {
        await context.dataClient.from('interview_material_info_summaries')
          .update({status:'failed',error:'クラウドAIで要約を作成できませんでした。',updated_at:new Date().toISOString()})
          .eq('student_number',number).eq('source_hash',row.source_hash).eq('claimed_at',lease).eq('status','running');
        throw new InterviewError('AI要約を作成できませんでした。資料の保存はそのまま利用できます。',503);
      }
    }
    if (row.status === 'queued' && row.requested) return staffResponse({status:row.status,execution:engine},context);
    const { error } = await context.dataClient.from('interview_material_info_summaries')
      .update({ status: 'queued', requested: true, attempts: 0, error: null, updated_at: new Date().toISOString() })
      .eq('student_number', number).eq('source_hash', row.source_hash);
    if (error) throw new InterviewError('AI要約を依頼できません。', 503);
    return staffResponse({ status: 'queued', execution: engine }, context);
  } catch (error) {
    return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context);
  }
}
