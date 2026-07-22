import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const studentNumber = url.searchParams.get("student_number");
  if (!date) return NextResponse.json({ lessons: [] });
  const supabase = createSupabaseAdminClient();
  let allowed: { grade: string; subject: string; class_name: string }[] = [];
  if (studentNumber) {
    const { data } = await supabase.from("student_class_enrollments").select("grade,subject,class_name").eq("student_number", studentNumber);
    allowed = data ?? [];
  }
  const { data, error } = await supabase.from("lessons").select("id,lesson_date,start_time,grade,class_name,subject,campus,classroom,label").eq("lesson_date", date).order("start_time");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const normalized = (value: string) => value.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
  const lessons = allowed.length === 0 ? data ?? [] : (data ?? []).filter((lesson) => allowed.some((entry) =>
    normalized(entry.grade) === normalized(lesson.grade ?? "") &&
    normalized(entry.class_name) === normalized(lesson.class_name ?? "") &&
    (normalized(entry.subject).includes(normalized(lesson.subject ?? "")) || normalized(lesson.subject ?? "").includes(normalized(entry.subject)))
  ));
  return NextResponse.json({ lessons });
}
