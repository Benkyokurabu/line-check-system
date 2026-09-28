import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InterviewError } from './interview-core.mjs';
import { academicGrade } from './student-academic-grade.mjs';

type MaterialStudent = {
  student_number: string | null;
  student_name: string | null;
  grade: string | null;
  homeroom_teacher: string | null;
  enrollment_status: string | null;
};

/** The materials screen needs the roster, not bookings, lessons or interview slots. */
export async function loadMaterialStudents(db: SupabaseClient): Promise<MaterialStudent[]> {
  const rows: MaterialStudent[] = [];
  const at = new Date();
  for (let offset = 0; offset < 20000; offset += 500) {
    const { data, error } = await db.from('student_registry')
      .select('student_number,student_name,grade,homeroom_teacher,enrollment_status')
      .eq('enrollment_status', 'current_roster').order('student_number').range(offset, offset + 499);
    if (error || !data) throw new InterviewError('生徒台帳を取得できません。接続・設定を確認してください。', 503);
    rows.push(...data);
    if (data.length < 500) return rows.map(student => ({
      ...student, grade: academicGrade(student.student_number, at) ?? student.grade,
    })).filter(student => /^(小[4-6]|中[1-3])$/.test(String(student.grade ?? '')));
  }
  throw new InterviewError('生徒台帳の件数が上限を超えました。', 503);
}
