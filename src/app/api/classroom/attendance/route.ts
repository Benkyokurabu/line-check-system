import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LessonRow = {
  id: string;
  lesson_date: string;
  start_time: string | null;
  grade: string | null;
  class_name: string | null;
  subject: string | null;
  campus: string | null;
  classroom: string | null;
  teacher_name: string | null;
  label: string;
};

type EventRow = {
  id: string;
  lesson_id: string;
  student_number: string;
  event_type: string;
  reason: string | null;
  arrival_expected_time: string | null;
  note_for_classroom: string | null;
  confirmed_at: string | null;
  student_roster?: { student_name: string | null; grade: string | null } | { student_name: string | null; grade: string | null }[] | null;
};

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function minutesFromStart(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

function currentJstMinutes() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function lessonEndMinutes(lesson: LessonRow) {
  const start = minutesFromStart(lesson.start_time);
  if (!Number.isFinite(start)) return start;
  return start + 95;
}

function pickLesson(lessons: LessonRow[], selectedLessonId: string | null) {
  if (selectedLessonId) {
    const selected = lessons.find((lesson) => lesson.id === selectedLessonId);
    if (selected) return selected;
  }
  const now = currentJstMinutes();
  return lessons.find((lesson) => {
    const start = minutesFromStart(lesson.start_time);
    return Number.isFinite(start) && start <= now && now <= lessonEndMinutes(lesson);
  }) ?? lessons.find((lesson) => minutesFromStart(lesson.start_time) >= now) ?? lessons[0] ?? null;
}

function firstRoster(value: EventRow["student_roster"]) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function eventTypeRank(value: string) {
  if (value === "late") return 1;
  if (value === "early_leave") return 2;
  return 0;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const campus = url.searchParams.get("campus")?.trim();
  const classroom = url.searchParams.get("classroom")?.trim();
  const date = url.searchParams.get("date")?.trim() || todayJst();
  const lessonId = url.searchParams.get("lesson_id")?.trim() || null;

  if (!campus || !classroom) {
    return NextResponse.json({ error: "校舎と教室を指定してください" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: lessonData, error: lessonError } = await supabase
    .from("lessons")
    .select("id,lesson_date,start_time,grade,class_name,subject,campus,classroom,teacher_name,label")
    .eq("lesson_date", date)
    .eq("campus", campus)
    .eq("classroom", classroom)
    .order("start_time", { ascending: true });

  if (lessonError) return NextResponse.json({ error: lessonError.message }, { status: 500 });
  const lessons = (lessonData ?? []) as LessonRow[];
  const selectedLesson = pickLesson(lessons, lessonId);

  if (!selectedLesson) {
    return NextResponse.json({
      date,
      campus,
      classroom,
      lessons,
      selected_lesson: null,
      events: [],
      message: "本日この教室の授業はありません",
      fetched_at: new Date().toISOString(),
    });
  }

  const { data: eventData, error: eventError } = await supabase
    .from("attendance_events")
    .select("id,lesson_id,student_number,event_type,reason,arrival_expected_time,note_for_classroom,confirmed_at,student_roster(student_name,grade)")
    .eq("lesson_id", selectedLesson.id)
    .eq("status", "confirmed");

  if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });

  const events = ((eventData ?? []) as EventRow[])
    .map((event) => {
      const roster = firstRoster(event.student_roster);
      return {
        id: event.id,
        lesson_id: event.lesson_id,
        student_number: event.student_number,
        student_name: roster?.student_name ?? "名前未取得",
        grade: roster?.grade ?? null,
        event_type: event.event_type,
        reason: event.reason,
        arrival_expected_time: event.arrival_expected_time,
        note_for_classroom: event.note_for_classroom,
        confirmed_at: event.confirmed_at,
      };
    })
    .sort((a, b) => eventTypeRank(a.event_type) - eventTypeRank(b.event_type) || a.student_name.localeCompare(b.student_name, "ja"));

  return NextResponse.json({
    date,
    campus,
    classroom,
    lessons,
    selected_lesson: selectedLesson,
    events,
    message: events.length === 0 ? "欠席・遅刻連絡はありません" : null,
    fetched_at: new Date().toISOString(),
  });
}
