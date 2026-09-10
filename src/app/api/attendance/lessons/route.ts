import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { enrollmentCampusForLesson, enrollmentMatchesLesson } from "@/lib/attendance-campus-consistency.mjs";
import { attendanceRangeDates } from "@/lib/attendance-date-range.mjs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const studentNumber = url.searchParams.get("student_number");
  const rangeRequested = url.searchParams.has("date_from") || url.searchParams.has("date_to");
  let dates: string[];
  try {
    if (!rangeRequested && !date) return NextResponse.json({ lessons: [] });
    dates = attendanceRangeDates(rangeRequested ? url.searchParams.get("date_from") : date, rangeRequested ? url.searchParams.get("date_to") : date);
    if (rangeRequested && !studentNumber) return NextResponse.json({ error: "生徒を選択してください" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
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
  const query = () => supabase.from("lessons")
    .select("id,lesson_date,start_time,grade,class_name,subject,campus,classroom,label,source_payload")
    .gte("lesson_date", dates[0]).lte("lesson_date", dates[dates.length - 1])
    .order("lesson_date").order("start_time").order("id");
  const data = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await query().range(offset, offset + 999);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    data.push(...(result.data ?? []));
    if ((result.data ?? []).length < 1000) break;
  }
  const lessons = data.map((lesson) => {
    const enrolled = enrolledClasses.some((entry) => enrollmentMatchesLesson(entry, lesson, studentCampus));
    const enrollmentCampus = enrollmentCampusForLesson(enrolledClasses, lesson);
    return { ...lesson, enrolled, student_campus: studentCampus, enrollment_campus: enrollmentCampus };
  });
  return NextResponse.json({ lessons: rangeRequested ? lessons.filter((lesson) => lesson.enrolled) : lessons });
}
