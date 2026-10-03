import 'server-only';
import {createSupabaseAdminClient} from '@/lib/supabase';
export const calendarRaw = 'https://raw.githubusercontent.com/Benkyokurabu/student-calendar/main/';
export type Recording = {url:string;date:string;time:string;campus:string;room:string;label:string;grade:string;class:string;subject:string;[key:string]:unknown};
export type Publication = {event_key:string;event_keys:string[];source_url:string;source_urls:string[];lesson:Recording;mode:'private'|'scheduled'|'public'|'notion';release_at:string|null;version:number;updated_at:string;notion_page_id?:string|null;notion_ready?:boolean;notion_checks?:{campus:string;ready:boolean;verified:boolean}[];notion_error?:string;automatic?:boolean};
export async function readPublicationRules(db = createSupabaseAdminClient()) {
  const result = await db.from('recording_publications').select('*').order('updated_at');
  if (result.error) throw new Error('録画の公開設定を読み込めませんでした。');
  return result.data as Publication[];
}
export async function readRecordingMonth(month:string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('対象年月を確認してください。');
  const response = await fetch(calendarRaw + `zoom_recording_urls_${month}.json`, {cache:'no-store',signal:AbortSignal.timeout(15000)});
  if (response.status === 404) return {} as Record<string,Recording>;
  if (!response.ok) throw new Error('録画一覧を取得できませんでした。');
  return (await response.json()).entries as Record<string,Recording>;
}
