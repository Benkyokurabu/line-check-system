import { NextRequest } from 'next/server';
import { staffContext, staffErrorResponse, staffResponse } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';
import { MATERIAL_BUCKET } from '@/lib/interview-material-worker';
import { HOKUSHIN_CATALOG_PATH, validateHokushinCatalog } from '@/lib/hokushin-school-library.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role))
      throw new InterviewError('職員の権限を確認してください。', 403);
    const storage = context.dataClient.storage.from(MATERIAL_BUCKET);
    const { data: file, error } = await storage.download(HOKUSHIN_CATALOG_PATH);
    if (error || !file || file.size > 2_000_000)
      throw new InterviewError('北辰基礎資料の学校一覧を読み込めませんでした。時間をおいて再読み込みしてください。', 503);
    const catalog = validateHokushinCatalog(JSON.parse(await file.text()));
    const items = catalog.items as { id: string; school: string; reading: string; category: string; year: number; bytes: number; storagePath: string }[];
    // Allow enough time to download the entire offline library and conduct an interview.
    const { data: signed, error: signError } = await storage.createSignedUrls(items.map(item => item.storagePath), 7200);
    if (signError || signed?.length !== items.length || signed.some(item => item.error || !item.signedUrl))
      throw new InterviewError('北辰基礎資料を読み込めませんでした。再読み込みしてください。', 503);
    return staffResponse({ generatedAt: catalog.generatedAt, items: items.map((item, index) => ({
      id: item.id, school: item.school, reading: item.reading, category: item.category,
      year: item.year, bytes: item.bytes, previewUrl: signed[index].signedUrl,
    })) }, context);
  } catch (error) {
    return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context);
  }
}
