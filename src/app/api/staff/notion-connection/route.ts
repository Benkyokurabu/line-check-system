import { NextRequest } from 'next/server';
import { staffContext, staffErrorResponse, staffResponse } from '@/lib/staff-auth-http';
import { StaffAuthError } from '@/lib/staff-auth-core.mjs';
import { notionRequest } from '@/lib/notion';
import { notionConnectionStatus } from '@/lib/notion-connection-status.mjs';
import { BENSUKE_SOURCE } from '@/lib/bensuke-booking.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (context.staff.staffCode !== 'KUDO') throw new StaffAuthError('permission_denied', 403);
    const dataSources = [
      { label: '生徒情報', id: process.env.NOTION_STUDENT_DATA_SOURCE_ID || '19ef0120-80a7-80b7-9f23-000b21e0a53b' },
      { label: '欠席連絡', id: process.env.NOTION_ABSENCE_DATA_SOURCE_ID || '19ef0120-80a7-805c-ae16-000b7b414034' },
      { label: 'ベンスケ', id: process.env.NOTION_BENSUKE_DATA_SOURCE_ID || BENSUKE_SOURCE },
      { label: '面談記録', id: '19ef0120-80a7-808a-8992-000b85713577' },
    ];
    const result = await notionConnectionStatus({
      request: (path: string) => notionRequest(path, { cache: 'no-store', signal: AbortSignal.timeout(8000) }),
      tokenSource: process.env.NOTION_TOKEN !== undefined ? 'NOTION_TOKEN' : 'NOTION_API_KEY',
      dataSources,
    });
    return staffResponse(result, context);
  } catch (error) {
    if (!context || error instanceof StaffAuthError) return staffErrorResponse(error, context);
    return staffResponse({ error: 'Notionの接続を確認できませんでした。' }, context, 503);
  }
}
