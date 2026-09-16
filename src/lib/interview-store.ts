import 'server-only';
import {validateRecord} from './interview-record.mjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InterviewError, conflicts, validateAppointment, validateSettings, normalizeTeacher, generateSlots } from './interview-core.mjs';

type Row = Record<string, unknown>;
export async function readAll(db: SupabaseClient, table: string) {
  const rows: Row[] = [];
  for(let offset=0;offset<20000;offset+=500){
    const {data,error}=await db.from(table).select('*').order(table==='interview_slot_overrides'?'key':table==='student_registry'?'student_number':'id').range(offset,offset+499);
    if(error) throw new InterviewError('面談データを取得できません。接続・設定を確認してください。',503);
    rows.push(...data);if(data.length<500)return rows;
  }
  throw new InterviewError('取得件数が上限を超えました。管理者へお知らせください。',503);
}
export async function loadInterviewState(db: SupabaseClient) {
  const before=await db.rpc('interview_snapshot');
  if(before.error)throw new InterviewError('面談の保存先を利用できません。管理者へお知らせください。',503);
  const [settings,students,identities,lessons,bookings,slots]=await Promise.all([
    db.from('interview_settings').select('*').eq('id',true).single(),
    readAll(db,'student_registry'),readAll(db,'interview_students'),readAll(db,'lessons'),
    readAll(db,'interview_bookings'),readAll(db,'interview_slot_overrides'),
  ]);
  if(settings.error)throw new InterviewError('予約枠の設定を取得できません。',503);
  const after=await db.rpc('interview_snapshot');
  if(after.error||before.data!==after.data)throw new InterviewError('予定が更新されました。もう一度読み込んでください。',409);
  const byId=new Map(identities.filter(r=>!r.retired_at).map(r=>[r.id,r]));
  const roster:Row[]=students.map(row=>({...row,id:byId.get(row.interview_student_id)?.id??null}));
  return {snapshot:after.data as string,settings:settings.data,students:roster,lessons,bookings,slots};
}
export type InterviewState = Awaited<ReturnType<typeof loadInterviewState>>;
export function publicState(state: InterviewState, staff: {role:string}) {
  const privileged=['admin','office','employee'].includes(staff.role);
  const bookings=state.bookings.map(row=>({...row,data:privileged?row.data:Object.fromEntries(Object.entries(row.data as Row).filter(([k])=>!['record','note'].includes(k)))}));
  return {...state,bookings,canEdit:privileged,teachers:[...new Set([
    ...state.students.map(r=>normalizeTeacher(r.homeroom_teacher)),...state.lessons.map(r=>normalizeTeacher(r.teacher_name)),
  ].filter(Boolean))].sort()};
}
export function validateSave(body: Row,state: InterviewState) {
  if(typeof body.operationKey!=='string'||!/^[0-9a-f-]{36}$/i.test(body.operationKey)||body.snapshot!==state.snapshot)throw new InterviewError('一覧が更新されています。再読込して確認してください。',409);
  const action=String(body.action),settings=validateSettings(state.settings.data);
  if(action==='settings')return validateSettings(body.data);
  if(action==='slot'){
    const data=body.data as Row;
    if(!data||typeof data.key!=='string'||typeof data.hidden!=='boolean'||data.key.length>200)throw new InterviewError('予約枠の操作を確認してください。');
    return {key:data.key,hidden:data.hidden};
  }
  const existing=state.bookings.find(r=>r.id===body.id);
  let data:Row;
  if(['create','update'].includes(action)){
    data=validateAppointment(body.data,settings);
    const student=state.students.find(s=>s.id===data.studentId);
    if(!student)throw new InterviewError('生徒台帳との紐づけを確認してください。');
    const teachers=[...state.students.map(s=>normalizeTeacher(s.homeroom_teacher)),...state.lessons.map(s=>normalizeTeacher(s.teacher_name))];
    if(!teachers.includes(normalizeTeacher(data.teacher)))throw new InterviewError('登録済みの講師を選択してください。');
    data.teacher=normalizeTeacher(data.teacher);
    if(existing?.data&&(existing.data as Row).bensuke)data.bensuke=(existing.data as Row).bensuke;
  } else if(existing) data=existing.data as Row;
  else throw new InterviewError('対象の面談を再読込してください。',409);
  if(['create','update','confirm'].includes(action)){
    const reasons=conflicts({...data,id:existing?.id},state.lessons,state.bookings);
    if(reasons.length)throw new InterviewError(reasons.join('。'),409);
    const day=String(data.date);
    if(new Date(`${day}T${data.start}:00+09:00`).getTime()<=Date.now())throw new InterviewError('過去の時刻には予約を登録できません。');
    const hidden=state.slots.some(s=>s.key===[day,normalizeTeacher(data.teacher),data.campus,data.start].join('|')&&(s.data as Row)?.hidden);
    if(hidden)throw new InterviewError('非公開にした予約枠です。枠を戻してから登録してください。');
    // Allow explicitly reviewed manual bookings on non-teaching days; never infer a working day.
    const auto=generateSlots({date:day,teacher:String(data.teacher),campus:String(data.campus),lessons:state.lessons,bookings:state.bookings.filter(r=>r.id!==existing?.id),settings});
    if(!auto.some(r=>r.start===data.start)&&body.manualReviewed!==true)throw new InterviewError('自動作成枠以外の日時です。担当講師の勤務・開校状況を確認してください。');
    if((action==='confirm'||(action==='update'&&existing?.status==='confirmed'))&&body.externalReviewed!==true)throw new InterviewError('Notionの既存予定との重複・担当講師の対応可否を確認してください。');
    data={...data,manualReviewed:body.manualReviewed===true,externalReviewed:body.externalReviewed===true};
  }
  if(['complete','record'].includes(action)){
    return validateRecord(body.data,data,action);
  }
  if(!['create','update','confirm','cancel','reject'].includes(action))throw new InterviewError('操作を確認してください。');
  return data;
}
