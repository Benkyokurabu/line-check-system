import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClassRow = {
  campus: string;
  grade: string;
  subject: string;
  class_name: string;
};

function classId(row: ClassRow) {
  return `${row.campus}:${row.grade}:${row.subject}:${row.class_name}`;
}

function gradeOrder(grade: string) {
  const normalized = grade.normalize("NFKC");
  const prefix = normalized.startsWith("小") ? 0 : 10;
  const number = Number(normalized.replace(/[^0-9]/g, ""));
  return prefix + number;
}

function subjectOrder(subject: string) {
  return { 数学: 1, 英語: 2, 国語: 3 }[subject as "数学" | "英語" | "国語"] ?? 99;
}

export async function GET() {
  const supabase = createSupabaseAdminClient();
  const [
    { data, error },
    { data: students, error: studentsError },
  ] = await Promise.all([
    supabase
      .from("student_class_enrollments")
      .select("student_number,grade,subject,class_name"),
    supabase.from("student_roster").select("student_number,campus"),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (studentsError) {
    return NextResponse.json({ error: studentsError.message }, { status: 500 });
  }

  const map = new Map<string, ClassRow & { count: number }>();
  const campusByStudent = new Map(
    (students ?? []).map((student) => [student.student_number as string, (student.campus as string | null) ?? "未設定"]),
  );
  for (const row of (data ?? []) as Omit<ClassRow, "campus">[] & { student_number: string }[]) {
    const withCampus: ClassRow = {
      campus: campusByStudent.get(row.student_number) ?? "未設定",
      grade: row.grade,
      subject: row.subject,
      class_name: row.class_name,
    };
    const id = classId(withCampus);
    const current = map.get(id) ?? { ...withCampus, count: 0 };
    current.count += 1;
    map.set(id, current);
  }

  const classes = [...map.values()].sort((a, b) => {
    const campusDiff = a.campus.localeCompare(b.campus, "ja");
    if (campusDiff !== 0) return campusDiff;
    const gradeDiff = gradeOrder(a.grade) - gradeOrder(b.grade);
    if (gradeDiff !== 0) return gradeDiff;
    const subjectDiff = subjectOrder(a.subject) - subjectOrder(b.subject);
    if (subjectDiff !== 0) return subjectDiff;
    return a.class_name.localeCompare(b.class_name, "ja");
  }).map((row) => ({
    id: classId(row),
    label: `${row.campus} ${row.grade} ${row.subject}${row.class_name}`,
    ...row,
  }));

  return NextResponse.json({ classes });
}
