import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const studentNumber = url.searchParams.get("student_number");
  if (!date) return NextResponse.json({ lessons: [] });
  const supabase = createSupabaseAdminClient();
  let enrolledClasses: { grade: string; subject: string; class_name: string }[] = [];
  if (studentNumber) {
    const { data } = await supabase
      .from("student_class_enrollments")
      .select("grade,subject,class_name")
      .eq("student_number", studentNumber);
    enrolledClasses = data ?? [];
  }
  const { data, error } = await supabase
    .from("lessons")
    .select("id,lesson_date,start_time,grade,class_name,subject,campus,classroom,label,source_payload")
    .eq("lesson_date", date)
    .order("start_time");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const normalized = (value: string | null | undefined) => (value ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
  const lessons = (data ?? []).map((lesson) => {
    const enrolled = enrolledClasses.some((entry) =>
      normalized(entry.grade) === normalized(lesson.grade) &&
      normalized(entry.class_name) === normalized(lesson.class_name) &&
      (normalized(entry.subject).includes(normalized(lesson.subject)) || normalized(lesson.subject).includes(normalized(entry.subject)))
    );
    return { ...lesson, enrolled };
  });
  return NextResponse.json({ lessons });
}