import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClassRow = {
  grade: string;
  subject: string;
  class_name: string;
};

function classId(row: ClassRow) {
  return `${row.grade}:${row.subject}:${row.class_name}`;
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
  const { data, error } = await supabase
    .from("student_class_enrollments")
    .select("grade,subject,class_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const map = new Map<string, ClassRow & { count: number }>();
  for (const row of (data ?? []) as ClassRow[]) {
    const id = classId(row);
    const current = map.get(id) ?? { ...row, count: 0 };
    current.count += 1;
    map.set(id, current);
  }

  const classes = [...map.values()].sort((a, b) => {
    const gradeDiff = gradeOrder(a.grade) - gradeOrder(b.grade);
    if (gradeDiff !== 0) return gradeDiff;
    const subjectDiff = subjectOrder(a.subject) - subjectOrder(b.subject);
    if (subjectDiff !== 0) return subjectDiff;
    return a.class_name.localeCompare(b.class_name, "ja");
  }).map((row) => ({
    id: classId(row),
    label: `${row.grade} ${row.subject}${row.class_name}`,
    ...row,
  }));

  return NextResponse.json({ classes });
}
