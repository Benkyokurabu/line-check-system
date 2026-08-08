import { NextResponse } from "next/server";
import { notionAbsenceDataSourceId, notionRequest } from "@/lib/notion";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { pickClassroomLessonByEndBoundary } from "@/lib/classroom-lesson-picker.mjs";

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
  source_payload: Record<string, unknown> | null;
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

type NotionProperty = { type?: string };
type ResolvedProperty = { name: string; type: string };
type NotionPage = {
  id: string;
  created_time?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
};

const NOTION_SCHEMA_CACHE_MS = 5 * 60 * 1000;
let notionPropertiesPromise: Promise<Record<string, NotionProperty>> | null = null;
let notionPropertiesExpiresAt = 0;

type ClassroomMessage = {
  id: string;
  campus: string;
  classroom: string;
  message: string;
  created_by: string | null;
  expires_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type ClassroomEvent = {
  id: string;
  lesson_id: string;
  student_number: string;
  student_name: string;
  grade: string | null;
  event_type: string;
  reason: string | null;
  arrival_expected_time: string | null;
  note_for_classroom: string | null;
  confirmed_at: string | null;
};

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function todayJstStart() {
  return new Date(`${todayJst()}T00:00:00+09:00`).toISOString();
}

function isActiveClassroomMessage(row: ClassroomMessage, nowIso = new Date().toISOString()) {
  if (row.archived_at) return false;
  if (row.expires_at) return row.expires_at > nowIso;
  return row.created_at >= todayJstStart();
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

function pickLesson(lessons: LessonRow[], selectedLessonId: string | null) {
  if (selectedLessonId) {
    const selected = lessons.find((lesson) => lesson.id === selectedLessonId);
    if (selected) return selected;
  }
  return pickClassroomLessonByEndBoundary(lessons, currentJstMinutes());
}

function firstRoster(value: EventRow["student_roster"]) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function eventTypeRank(value: string) {
  if (value === "late") return 1;
  if (value === "early_leave") return 2;
  return 0;
}

const fullWidth = (value: string) => value.normalize("NFKC").replace(/[0-9A-Z]/g, (char) =>
  String.fromCharCode(char.charCodeAt(0) + 0xfee0),
);

function envFirst(envName: string, fallback: string[]) {
  const value = process.env[envName]?.trim();
  return value ? [value, ...fallback.filter((item) => item !== value)] : fallback;
}

function resolveProperty(properties: Record<string, NotionProperty>, names: string[]): ResolvedProperty | null {
  for (const name of names) {
    const property = properties[name];
    if (property?.type) return { name, type: property.type };
  }
  return null;
}

function dateFilter(property: ResolvedProperty, value: string) {
  return { property: property.name, date: { equals: value } };
}

function textEqualsFilter(property: ResolvedProperty, value: string) {
  if (property.type === "select") return { property: property.name, select: { equals: value } };
  if (property.type === "status") return { property: property.name, status: { equals: value } };
  if (property.type === "rich_text" || property.type === "title") return { property: property.name, rich_text: { equals: value } };
  return null;
}

function textContainsFilter(property: ResolvedProperty, value: string) {
  if (property.type === "select") return { property: property.name, select: { equals: value } };
  if (property.type === "rich_text" || property.type === "title") return { property: property.name, rich_text: { contains: value } };
  return null;
}

function notionText(property: unknown) {
  const value = property as {
    type?: string;
    title?: { plain_text?: string }[];
    rich_text?: { plain_text?: string }[];
    number?: number | null;
    select?: { name?: string } | null;
    status?: { name?: string } | null;
    formula?: { type?: string; string?: string | null; number?: number | null };
  } | null;
  if (!value) return null;
  if (value.type === "title") return value.title?.map((part) => part.plain_text ?? "").join("").trim() || null;
  if (value.type === "rich_text") return value.rich_text?.map((part) => part.plain_text ?? "").join("").trim() || null;
  if (value.type === "number") return value.number == null ? null : String(value.number);
  if (value.type === "select") return value.select?.name?.trim() || null;
  if (value.type === "status") return value.status?.name?.trim() || null;
  if (value.type === "formula" && value.formula?.type === "string") return value.formula.string?.trim() || null;
  if (value.type === "formula" && value.formula?.type === "number") return value.formula.number == null ? null : String(value.formula.number);
  return null;
}

function firstNotionText(properties: Record<string, unknown> | undefined, names: string[]) {
  for (const name of names) {
    const value = notionText(properties?.[name]);
    if (value) return value;
  }
  return null;
}

function notionOnlyStudentNumber(pageId: string) {
  return `notion:${pageId.replace(/-/g, "")}`;
}

function notionRelationIds(property: unknown) {
  const value = property as { type?: string; relation?: { id?: string }[] } | null;
  if (value?.type !== "relation") return [];
  return (value.relation ?? []).map((item) => item.id).filter((id): id is string => Boolean(id));
}

function notionCheckbox(property: unknown) {
  const value = property as { type?: string; checkbox?: boolean } | null;
  return value?.type === "checkbox" ? value.checkbox === true : null;
}

function notionLessonName(lesson: LessonRow) {
  const payload = lesson.source_payload ?? {};
  const gradeMap: Record<string, string> = { j1: "1", j2: "2", j3: "3", e4: "4", e5: "5", e6: "6" };
  const subjectMap: Record<string, string> = { eng: "英", math: "数", arith: "算", jp: "国", sci: "理", soc: "社" };
  const grade = gradeMap[String(payload.grade ?? "")] ?? "";
  const className = String(payload.class ?? "").trim();
  const subject = subjectMap[String(payload.subject ?? "")] ?? "";
  if (grade && className && subject) return fullWidth(`${grade}${className}${subject}`);
  return lesson.label.trim() || null;
}

function notionEventType(value: string | null) {
  if (value === "遅刻") return "late";
  if (value === "早退") return "early_leave";
  return "absence";
}

function isSharedNotionPage(page: NotionPage, statusProperty: ResolvedProperty | null, sharedProperty: ResolvedProperty | null) {
  const status = statusProperty ? notionText(page.properties?.[statusProperty.name]) : null;
  const shared = sharedProperty ? notionCheckbox(page.properties?.[sharedProperty.name]) : null;
  if (status) return status === "チェック済み" || status === "確認済み" || status === "対応済み";
  if (shared !== null) return shared;
  return true;
}

function notionProperties(dataSourceId: string) {
  const now = Date.now();
  if (notionPropertiesPromise && now < notionPropertiesExpiresAt) return notionPropertiesPromise;
  notionPropertiesExpiresAt = now + NOTION_SCHEMA_CACHE_MS;
  notionPropertiesPromise = notionRequest(`/data_sources/${dataSourceId}`)
    .then((dataSource) => ((dataSource as { properties?: Record<string, NotionProperty> }).properties ?? {}))
    .catch((error) => {
      notionPropertiesPromise = null;
      notionPropertiesExpiresAt = 0;
      throw error;
    });
  return notionPropertiesPromise;
}

async function fetchNotionClassroomEvents(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  date: string;
  selectedLesson: LessonRow;
}) {
  const dataSourceId = notionAbsenceDataSourceId();
  const properties = await notionProperties(dataSourceId);
  const studentProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_STUDENT_PROPERTY", ["生徒情報DB", "名前"]));
  const dateProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_DATE_PROPERTY", ["日付", "対象日"]));
  const reasonProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_REASON_PROPERTY", ["理由", "連絡名"]));
  const lessonProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_LESSON_PROPERTY", ["授業", "授業・クラス"]));
  const campusProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_CAMPUS_PROPERTY", ["授業校舎", "校舎"]));
  const typeProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_TYPE_PROPERTY", ["種別", "区分"]));
  const statusProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_STATUS_PROPERTY", ["状態", "ステータス"]));
  const sharedProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_SHARED_PROPERTY", ["スタッフ共有"]));
  if (!studentProperty || !dateProperty) return [];

  const filters: unknown[] = [dateFilter(dateProperty, input.date)];
  const campusFilter = campusProperty && input.selectedLesson.campus ? textEqualsFilter(campusProperty, input.selectedLesson.campus) : null;
  if (campusFilter) filters.push(campusFilter);
  const lessonName = notionLessonName(input.selectedLesson);
  const lessonFilter = lessonProperty && lessonName ? textContainsFilter(lessonProperty, lessonName) : null;
  if (lessonFilter) filters.push(lessonFilter);
  const query = await notionRequest(`/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body: JSON.stringify({
      page_size: 100,
      filter: filters.length === 1 ? filters[0] : { and: filters },
      sorts: [{ property: dateProperty.name, direction: "ascending" }],
    }),
  });
  const pages = ((query as { results?: NotionPage[] }).results ?? [])
    .filter((page) => isSharedNotionPage(page, statusProperty, sharedProperty));
  const studentPageIds = [...new Set(pages.flatMap((page) => notionRelationIds(page.properties?.[studentProperty.name])))];
  if (studentPageIds.length === 0) return [];

  const { data: profiles, error: profileError } = await input.supabase
    .from("notion_student_profiles")
    .select("student_number,notion_page_id,student_roster(student_name,grade)")
    .in("notion_page_id", studentPageIds);
  if (profileError) throw profileError;

  const profileByPageId = new Map((profiles ?? []).map((profile) => {
    const roster = firstRoster(profile.student_roster as EventRow["student_roster"]);
    return [profile.notion_page_id as string, {
      student_number: profile.student_number as string,
      student_name: roster?.student_name ?? null,
      grade: roster?.grade ?? null,
    }];
  }));
  const missingStudentPageIds = studentPageIds.filter((pageId) => !profileByPageId.get(pageId)?.student_name);
  const notionStudentPages = await Promise.all(missingStudentPageIds.map(async (pageId) => {
    const page = await notionRequest(`/pages/${pageId}`).catch(() => null) as NotionPage | null;
    return [pageId, page] as const;
  }));
  for (const [pageId, page] of notionStudentPages) {
    const current = profileByPageId.get(pageId);
    const properties = page?.properties;
    const studentNumber = firstNotionText(properties, ["学籍番号", "生徒番号", "番号"]);
    profileByPageId.set(pageId, {
      student_number: current?.student_number ?? studentNumber ?? notionOnlyStudentNumber(pageId),
      student_name: current?.student_name ?? firstNotionText(properties, ["生徒氏名", "名前", "氏名"]) ?? "名前未取得",
      grade: current?.grade ?? firstNotionText(properties, ["学年"]),
    });
  }
  const existingKeys = new Set<string>();
  const events: ClassroomEvent[] = [];
  for (const page of pages) {
    const studentPageId = notionRelationIds(page.properties?.[studentProperty.name])[0];
    const profile = studentPageId ? profileByPageId.get(studentPageId) : null;
    if (!profile) continue;
    const key = `${profile.student_number}:${input.selectedLesson.id}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    events.push({
      id: `notion:${page.id}`,
      lesson_id: input.selectedLesson.id,
      student_number: profile.student_number,
      student_name: profile.student_name ?? "名前未取得",
      grade: profile.grade,
      event_type: notionEventType(typeProperty ? notionText(page.properties?.[typeProperty.name]) : null),
      reason: reasonProperty ? notionText(page.properties?.[reasonProperty.name]) : "欠席連絡",
      arrival_expected_time: null,
      note_for_classroom: null,
      confirmed_at: page.last_edited_time ?? page.created_time ?? null,
    });
  }
  return events;
}


async function fetchClassroomMessages(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  campus: string;
  classroom: string;
}) {
  const { data, error } = await input.supabase
    .from("classroom_messages")
    .select("id,campus,classroom,message,created_by,expires_at,archived_at,created_at,updated_at")
    .eq("campus", input.campus)
    .eq("classroom", input.classroom)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as ClassroomMessage[]).filter((row) => isActiveClassroomMessage(row)).slice(0, 20);
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
    .select("id,lesson_date,start_time,grade,class_name,subject,campus,classroom,teacher_name,label,source_payload")
    .eq("lesson_date", date)
    .eq("campus", campus)
    .eq("classroom", classroom)
    .order("start_time", { ascending: true });

  if (lessonError) return NextResponse.json({ error: lessonError.message }, { status: 500 });
  const lessons = (lessonData ?? []) as LessonRow[];
  const selectedLesson = pickLesson(lessons, lessonId);
  const classroomMessages = await fetchClassroomMessages({ supabase, campus, classroom })
    .catch(() => [] as ClassroomMessage[]);

  if (!selectedLesson) {
    return NextResponse.json({
      date,
      campus,
      classroom,
      lessons,
      selected_lesson: null,
      events: [],
      messages: classroomMessages,
      message: "本日この教室の授業はありません",
      notion_warning: null,
      fetched_at: new Date().toISOString(),
    });
  }

  const eventRequest = supabase
    .from("attendance_events")
    .select("id,lesson_id,student_number,event_type,reason,arrival_expected_time,note_for_classroom,confirmed_at,student_roster(student_name,grade)")
    .eq("lesson_id", selectedLesson.id)
    .eq("status", "confirmed");

  const [eventResult, notionResult] = await Promise.all([
    eventRequest,
    fetchNotionClassroomEvents({ supabase, date, selectedLesson })
      .then((events) => ({ events, warning: null as string | null }))
      .catch((error) => ({
        events: [] as ClassroomEvent[],
        warning: error instanceof Error ? `Notionの欠席連絡を取得できませんでした: ${error.message}` : "Notionの欠席連絡を取得できませんでした",
      })),
  ]);
  const { data: eventData, error: eventError } = eventResult;
  if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });

  const dbEvents = ((eventData ?? []) as EventRow[])
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
    });

  const dbEventKeys = new Set(dbEvents.map((event) => `${event.student_number}:${event.lesson_id}`));
  const notionEvents = notionResult.events.filter((event) => !dbEventKeys.has(`${event.student_number}:${event.lesson_id}`));
  const events = [...dbEvents, ...notionEvents]
    .sort((a, b) => eventTypeRank(a.event_type) - eventTypeRank(b.event_type) || a.student_name.localeCompare(b.student_name, "ja"));

  return NextResponse.json({
    date,
    campus,
    classroom,
    lessons,
    selected_lesson: selectedLesson,
    events,
    messages: classroomMessages,
    message: events.length === 0 ? "欠席・遅刻連絡はありません" : null,
    notion_warning: notionResult.warning,
    fetched_at: new Date().toISOString(),
  });
}
