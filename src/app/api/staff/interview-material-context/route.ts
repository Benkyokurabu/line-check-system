import { NextRequest } from 'next/server';
import { staffContext, staffResponse, staffErrorResponse } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';
import { notionRequest } from '@/lib/notion';
import { materialRecord, notionBlockText, notionPropertyText, recentRecordCandidates, schoolForSiblingResults, schoolMentionsFromRecords, siblingSchoolLookups, studentInfoCandidates } from '@/lib/interview-material-context-core.mjs';
import { infoSourceHash } from '@/lib/interview-material-info-summary.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const interviewSource = '19ef0120-80a7-808a-8992-000b85713577';
const graduateSchoolSources = [
  '67a016ee-cf53-41ac-a56d-9bc5810a57ec', // 2025年卒業生の進学先
  '1aef0120-80a7-8074-8a78-000bcabe3f7e', // 本校合否結果
];
const recentRecordCount = 3;
type NotionPage = { id: string; url?: string; created_time?: string; parent?: { data_source_id?: string }; properties: Record<string, unknown> };
type NotionBlock = { id: string; type: string; has_children?: boolean; [key: string]: unknown };

async function allBlocks(pageId: string, budget = { pages: 0 }) {
  const lines: string[] = [];
  let cursor = '';
  do {
    if (++budget.pages > 100) throw new InterviewError('面談記録が長いため全文を取得できません。Notionの原本を確認してください。', 503);
    const result = await notionRequest(`/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const block of (result.results ?? []) as NotionBlock[]) {
      const line = notionBlockText(block);
      if (line) lines.push(line);
      if (block.has_children) lines.push(...await allBlocks(block.id, budget));
    }
    if (result.has_more && !result.next_cursor) throw new InterviewError('Notionの面談記録を最後まで取得できません。', 503);
    cursor = result.has_more ? result.next_cursor : '';
  } while (cursor);
  return lines;
}

async function interviewIds(page: NotionPage) {
  const property = page.properties['面談DB'] as { id?: string; relation?: Array<{ id: string }>; has_more?: boolean } | undefined;
  if (!property) return [];
  const ids = (property.relation ?? []).map(item => item.id);
  if (!property.has_more || !property.id) return ids;
  let cursor = '';
  const complete: string[] = [];
  for (let index = 0; index < 10; index++) {
    const result = await notionRequest(`/pages/${page.id}/properties/${encodeURIComponent(property.id)}?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
    complete.push(...(result.results ?? []).map((item: { relation?: { id?: string } }) => item.relation?.id).filter(Boolean));
    if (!result.has_more || !result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return [...new Set(complete)];
}

async function siblingSchools(properties: Record<string, unknown>) {
  const schools = ['', '', ''];
  let warning = '';
  const results = new Map<string, NotionPage[]>();
  for (const lookup of siblingSchoolLookups(properties)) {
    let failed = false;
    for (const source of graduateSchoolSources) {
      try {
        const key = `${source}:${lookup.search}`;
        if (!results.has(key)) {
          const pages: NotionPage[] = [];
          let cursor = '';
          for (let index = 0; index < 3; index++) {
            const result = await notionRequest(`/data_sources/${source}/query`, {
              method: 'POST', body: JSON.stringify({ page_size: 100, filter: { property: '名前', title: { contains: lookup.search } },
                ...(cursor ? { start_cursor: cursor } : {}) }),
            });
            pages.push(...(result.results ?? []) as NotionPage[]);
            if (!result.has_more) break;
            if (!result.next_cursor || index === 2) throw new Error('Graduate school lookup is incomplete');
            cursor = result.next_cursor;
          }
          results.set(key, pages);
        }
        schools[lookup.index] = schoolForSiblingResults(results.get(key) ?? [], lookup.fullName);
        if (schools[lookup.index]) break;
      } catch {
        failed = true;
      }
    }
    if (failed && !schools[lookup.index]) warning = '兄弟姉妹の進学先一覧を一部確認できませんでした。Notionの接続と原本を確認してください。';
  }
  return { schools, warning };
}

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('職員の権限を確認してください。', 403);
    const number = request.nextUrl.searchParams.get('number') ?? '';
    if (!/^\d{5,12}$/.test(number)) throw new InterviewError('生徒番号を確認してください。', 400);
    const { data: student, error: studentError } = await context.dataClient.from('student_registry')
      .select('notion_page_id,student_name,grade').eq('student_number', number).eq('enrollment_status', 'current_roster').maybeSingle();
    if (studentError) throw new InterviewError('生徒台帳を取得できません。', 503);
    if (!student) throw new InterviewError('在籍生徒が見つかりません。', 404);
    let pageId = student.notion_page_id as string | null;
    if (!pageId) {
      const { data: mapping, error: mappingError } = await context.dataClient.from('notion_student_profiles')
        .select('notion_page_id').eq('student_number', number).order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (mappingError) throw new InterviewError('Notionの生徒対応表を取得できません。', 503);
      pageId = mapping?.notion_page_id ?? null;
    }
    if (!pageId) return staffResponse({ records: [], schoolMentions: [], info: [], summary: { status: 'empty', items: [] }, studentUrl: '', source: 'notion' }, context);
    const page = await notionRequest(`/pages/${pageId}`) as NotionPage;
    if (notionPropertyText(page.properties['学籍番号']) !== number) throw new InterviewError('Notionの生徒番号が一致しません。', 409);
    const ids = await interviewIds(page);
    const recordPages: NotionPage[] = [];
    for (const id of ids) {
      const record = await notionRequest(`/pages/${id}`) as NotionPage;
      if (record.parent?.data_source_id !== interviewSource) continue;
      recordPages.push(record);
    }
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const middleSecond = String(student.grade ?? '').normalize('NFKC') === '中2';
    recordPages.sort((a, b) => materialRecord(b, '').date.localeCompare(materialRecord(a, '').date));
    const records = [];
    const schoolRecords = [];
    for (const record of recordPages) {
      if (materialRecord(record, '').date.slice(0, 10) > today) continue;
      if (records.length >= recentRecordCount && !middleSecond) break;
      const body = (await allBlocks(record.id)).join('\n\n');
      const parsed = materialRecord(record, body);
      if (records.length < recentRecordCount) records.push(parsed);
      if (middleSecond) schoolRecords.push(parsed);
    }
    const schoolMentions = schoolMentionsFromRecords(schoolRecords);
    const siblingSchoolResult = await siblingSchools(page.properties);
    const info = studentInfoCandidates(page.properties, student.grade as string, siblingSchoolResult.schools);
    const summaryFields = [...recentRecordCandidates(records), ...info];
    let summary: { status: string; items: unknown[]; sourceHash?: string } = { status: 'empty', items: [] };
    if (summaryFields.length) {
      const sourceHash = infoSourceHash(summaryFields);
      const { data: existing, error: readError } = await context.dataClient.from('interview_material_info_summaries')
        .select('source_hash,status,requested,result').eq('student_number', number).maybeSingle();
      if (readError) throw new InterviewError('情報の要約を確認できません。', 503);
      if (!existing || existing.source_hash !== sourceHash) {
        const { error: queueError } = await context.dataClient.from('interview_material_info_summaries')
          .upsert({ student_number: number, source_hash: sourceHash, fields: summaryFields, status: 'queued', requested: false,
            result: [], error: null, attempts: 0, claimed_at: null, updated_at: new Date().toISOString() }, { onConflict: 'student_number' });
        if (queueError) throw new InterviewError('情報の要約を依頼できません。', 503);
        summary = { status: 'prepared', items: [], sourceHash };
      } else summary = { sourceHash, status: existing.status === 'queued' && !existing.requested ? 'prepared' : existing.status,
        items: Array.isArray(existing.result) ? existing.result : [] };
    }
    return staffResponse({ records, schoolMentions, info, summary, siblingSchoolWarning: siblingSchoolResult.warning,
      studentUrl: page.url ?? '', source: 'notion' }, context);
  } catch (error) {
    return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context);
  }
}
