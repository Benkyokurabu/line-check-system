import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { buildStudentSearchOptions } from "@/lib/student-search-options.mjs";
import { withAcademicGrade } from "@/lib/student-academic-grade.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = createSupabaseAdminClient();
  const students = [];
  const at = new Date();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("student_registry")
      .select("student_number,student_name,grade,campus,homeroom_teacher,school_name,instruction_type,enrollment_status,notion_page_id")
      .order("student_number").range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    students.push(...(data ?? []).map(student => withAcademicGrade(student, at)));
    if (!data || data.length < 1000) break;
  }
  // Keep former students distinct from active students, even when names match.
  return NextResponse.json({ students: [
    ...buildStudentSearchOptions(students.filter(s => s.enrollment_status === "current_roster")),
    ...students.filter(s => s.enrollment_status !== "current_roster").map(s => ({ ...s, record_origin: "registry" })),
  ] });
}
