import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { buildStudentSearchOptions } from "@/lib/student-search-options.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("student_roster")
    .select("student_number,student_name,grade,campus,homeroom_teacher,school_name,instruction_type,source_file")
    .order("grade", { ascending: true })
    .order("student_number", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ students: buildStudentSearchOptions(data ?? []) });
}
