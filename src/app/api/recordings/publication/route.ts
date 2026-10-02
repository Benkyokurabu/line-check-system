import {NextResponse} from 'next/server';
import {readPublicationRules} from '@/lib/recording-publication-store';
import {publicRecordingRules} from '@/lib/recording-publication.mjs';
export const dynamic = 'force-dynamic';
const headers = {'Cache-Control':'no-store','Access-Control-Allow-Origin':'https://benkyokurabu.github.io','Vary':'Origin'};
export async function GET() {
  try { return NextResponse.json({generatedAt:new Date().toISOString(),rules:publicRecordingRules(await readPublicationRules())},{headers}); }
  catch { return NextResponse.json({error:'録画公開設定を取得できませんでした。'},{status:503,headers}); }
}
