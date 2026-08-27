import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { enrollmentCampusForLesson, enrollmentMatchesLesson } from "@/lib/attendance-campus-consistency.mjs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const studentNumber = url.searchParams.get("student_number");
  if (!date) return NextResponse.json({ lessons: [] });
  const supabase = createSupabaseAdminClient();
  let enrolledClasses: { grade: string; subject: string; class_name: string; classroom: string | null }[] = [];
  let studentCampus: string | null = null;
  if (studentNumber) {
    const [enrollmentResult, rosterResult] = await Promise.all([
      supabase.from("student_class_enrollments").select("grade,subject,class_name,classroom").eq("student_number", studentNumber),
      supabase.from("student_roster").select("campus").eq("student_number", studentNumber).maybeSingle(),
    ]);
    if (enrollmentResult.error) return NextResponse.json({ error: enrollmentResult.error.message }, { status: 500 });
    if (rosterResult.error) return NextResponse.json({ error: rosterResult.error.message }, { status: 500 });
    enrolledClasses = enrollmentResult.data ?? [];
    studentCampus = rosterResult.data?.campus ?? null;
  }
  const { data, error } = await supabase
    .from("lessons")
    .select("id,lesson_date,start_time,grade,class_name,subject,campus,classroom,label,source_payload")
    .eq("lesson_date", date)
    .order("start_time");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const lessons = (data ?? []).map((lesson) => {
    const enrolled = enrolledClasses.some((entry) => enrollmentMatchesLesson(entry, lesson, studentCampus));
    const enrollmentCampus = enrollmentCampusForLesson(enrolledClasses, lesson);
    return { ...lesson, enrolled, student_campus: studentCampus, enrollment_campus: enrollmentCampus };
  });
  return NextResponse.json({ lessons });
}
