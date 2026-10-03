import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,assertStaffMutationOrigin,staffJsonBody} from '@/lib/staff-auth-http';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {recordingAdmin,validRecordingKey,releaseTime,publicationStatus} from '@/lib/recording-publication.mjs';
import {readPublicationRules,readRecordingMonth} from '@/lib/recording-publication-store';
import {readProgressRows,readLinkedProgress,resolveNotionRules,automaticTestRules} from '@/lib/recording-notion';
import {matchesRecordingProgress} from '@/lib/recording-notion-core.mjs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:NextRequest) {
 let context;
 try {
  context=await staffContext(request);
  if (!recordingAdmin(context.staff)) throw new StaffAuthError('permission_denied',403);
  const month=request.nextUrl.searchParams.get('month') || new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  let notionError='';
  const [entries,rules,progress,automatic]=await Promise.all([readRecordingMonth(month),readPublicationRules(context.dataClient).then(resolveNotionRules),readProgressRows(month).catch(()=>{notionError='Notionの対象行を取得できませんでした。再読み込みしてください。';return [];}),automaticTestRules().catch(()=>{notionError='Notionの両教室のチェックを確認できません。再読み込みしてください。';return [];})]);
  const rows=Object.entries(entries).map(([key,lesson])=>{
   const rule=rules.find(r=>r.event_keys.includes(key));
   const fields=key.split('|'),automaticRule=automatic.find(r=>r.match.date===fields[0]&&r.match.campus===fields[2]&&r.match.group===fields[3]);
   return {key,lesson,rule,status:rule?publicationStatus(rule):automaticRule?.status || (notionError?'hidden':'public'),jsonHidden:!lesson.url,notionOptions:progress.filter(p=>matchesRecordingProgress(key,p))};
  });
  return staffResponse({rows,month,notionError},context);
 } catch(error) { return error instanceof StaffAuthError?staffErrorResponse(error,context):staffResponse({error:error instanceof Error?error.message:'録画一覧の取得に失敗しました。'},context,503); }
}
export async function POST(request:NextRequest) {
 let context;
 try {
  assertStaffMutationOrigin(request);context=await staffContext(request);
  if (!recordingAdmin(context.staff)) throw new StaffAuthError('permission_denied',403);
  const body=await staffJsonBody(request);
  if (!validRecordingKey(body.key) || !['private','scheduled','public','notion'].includes(String(body.mode)) || !Number.isInteger(body.version) || Number(body.version)<0) throw new StaffAuthError('invalid_request',400);
  const key=String(body.key),mode=String(body.mode);
  let releaseAt=null;
  if(mode==='scheduled') {try {releaseAt=releaseTime(body.releaseAt);} catch(e) {return staffResponse({error:(e as Error).message},context,400);} }
  let notionPageId=null;
  if(mode==='notion'){
   try {notionPageId=String(body.notionPageId ?? '');await readLinkedProgress(key,notionPageId);}
   catch(e){return staffResponse({error:(e as Error).message},context,400);}
  }
  const [entries,rules]=await Promise.all([readRecordingMonth(key.slice(0,7)),readPublicationRules(context.dataClient)]);
  const existing=rules.find(r=>r.event_keys.includes(key));
  const lesson=entries[key];
  if (!lesson) return staffResponse({error:'対象授業の録画が見つかりません。'},context,404);
  const url=lesson.url || existing?.source_url;
  if (!url || !/^https:\/\//.test(url)) return staffResponse({error:'再公開用の録画URLを取得できません。'},context,409);
  const keys=[...new Set([key,...(existing?.event_keys || []),...Object.entries(entries).filter(([,r])=>r.url===url).map(([k])=>k)])];
  const urls=[...new Set([url,...(existing?.source_urls || [])])];
  const result=await context.dataClient.rpc('save_recording_publication',{p_key:existing?.event_key || key,p_keys:keys,p_url:url,p_urls:urls,p_lesson:lesson,p_mode:mode,p_release_at:releaseAt,p_version:body.version,p_staff:context.staff.staffId,p_notion_page_id:notionPageId});
  if(result.error) return staffResponse({error:result.error.code==='PT409'?'別の操作で設定が変わりました。一覧を更新してください。':'録画の公開設定を保存できませんでした。'},context,result.error.code==='PT409'?409:503);
  const [resolved]=await resolveNotionRules([result.data]);
  return staffResponse({saved:true,rule:resolved,status:publicationStatus(resolved)},context);
 } catch(error) {return staffErrorResponse(error,context);}
}
