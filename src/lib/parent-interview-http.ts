import 'server-only';
import {NextRequest,NextResponse} from 'next/server';
import {createSupabaseAdminClient} from './supabase';
import {hashToken,parentCookie} from './parent-line-login.mjs';
import {InterviewError} from './interview-core.mjs';
import {StaffAuthError} from './staff-auth-core.mjs';
export const parentResponse=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export async function parentContext(request:NextRequest){
 const token=request.cookies.get(parentCookie)?.value;
 if(!token||!/^[a-zA-Z0-9_-]{43}$/.test(token))throw new InterviewError('LINEからログインしてください。',401);
 const db=createSupabaseAdminClient(),hash=hashToken(token);
 const {data,error}=await db.from('interview_parent_sessions').select('line_user_id,expires_at').eq('token_hash',hash).maybeSingle();
 if(error)throw new InterviewError('接続を確認して、もう一度お試しください。',503);
 if(!data||Date.parse(data.expires_at)<=Date.now())throw new InterviewError('LINEからログインしてください。',401);
 return {db,hash,lineUserId:data.line_user_id as string};
}
export function parentFailure(error:unknown){return parentResponse({error:error instanceof InterviewError?error.message:error instanceof StaffAuthError?'予約画面から操作してください。':'接続を確認して、もう一度お試しください。'},error instanceof InterviewError||error instanceof StaffAuthError?error.status:503);}
export function requestDbError(error:{message:string}|null){
 if(!error)return;
 const messages:Record<string,[string,number]>={parent_session_required:['LINEからログインしてください。',401],parent_subject_denied:['お子さまとの登録を確認できません。教室にご連絡ください。',403],request_already_active:['既に申請中または確定済みの面談があります。',409],slot_unavailable:['選んだ日程の受付状況が変わりました。日程を選び直してください。',409],slot_changed:['日程が変更されています。希望を確認し直してください。',409],version_conflict:['予約が更新されています。最新の内容を確認してください。',409],idempotency_conflict:['送信内容が変わっています。最新の内容を確認してください。',409],invalid_choices:['日程を重複なく1〜3つ選んでください。',422],reason_required:['保護者への連絡事項を入力してください。',422]};
 const [message,status]=messages[error.message]??['保存できませんでした。同じ操作の結果を再確認してください。',503];throw new InterviewError(message,status);
}
