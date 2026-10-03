import {NextResponse} from 'next/server';
import {readPublicationRules} from '@/lib/recording-publication-store';
import {publicRecordingRules} from '@/lib/recording-publication.mjs';
import {resolveNotionRules,automaticTestRules} from '@/lib/recording-notion';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = {'Cache-Control':'no-store','Access-Control-Allow-Origin':'https://benkyokurabu.github.io','Vary':'Origin'};
export async function GET() {
  try {const [rules,automatic]=await Promise.all([readPublicationRules().then(resolveNotionRules),automaticTestRules()]);return NextResponse.json({generatedAt:new Date().toISOString(),rules:[...publicRecordingRules(rules),...automatic]},{headers}); }
  catch { return NextResponse.json({error:'録画公開設定を取得できませんでした。'},{status:503,headers}); }
}
