import { NextResponse } from "next/server";
import { archiveAttendanceNotionPage, upsertAttendanceNotionPage, type AttendanceNotionEvent } from "@/lib/attendance-notion";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { enrollmentCampusForLesson, validateAttendanceCampusSelection } from "@/lib/attendance-campus-consistency.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contactMethods = new Set(["phone", "oral", "other"]);
const eventTypes = new Set(["absence", "late", "early_leave"]);

type EventWithLesson = AttendanceNotionEvent & {
  id: string;
  notion_page_id: string | null;
  lessons: AttendanceNotionEvent["lessons"];
};

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function cleanContactMethod(value: unknown) {
  return typeof value === "string" && contactMethods.has(value) ? value : "other";
}

function cleanEventType(value: unknown) {
  return typeof value === "string" && eventTypes.has(value) ? value : "absence";
}

function parseUpdate(body: Record<string, unknown>) {
  const studentNumber = cleanText(body.student_number);
  const lessonId = cleanText(body.lesson_id);
  const eventDate = cleanDate(body.event_date);
  if (!studentNumber) throw new Error("生徒を選択してください");
  if (!lessonId) throw new Error("授業を選択してください");
  if (!eventDate) throw new Error("対象日を入力してください");
  return {
    contact_method: cleanContactMethod(body.contact_method),
    received_by: cleanText(body.received_by),
    student_number: studentNumber,
    lesson_id: lessonId,
    event_date: eventDate,
    event_type: cleanEventType(body.event_type),
    reason: cleanText(body.reason),
    arrival_expected_time: cleanText(body.arrival_expected_time),
    note_internal: cleanText(body.note_internal),
    note_for_classroom: cleanText(body.note_for_classroom),
    cross_campus_override: body.cross_campus_override === true,
    cross_campus_reason: cleanText(body.cross_campus_reason),
    status: "confirmed",
    cancelled_by: null,
    cancelled_at: null,
    notion_status: "pending",
    notion_error: null,
  };
}

async function fetchEvent(supabase: ReturnType<typeof createSupabaseAdminClient>, id: string) {
  const { data, error } = await supabase
    .from("attendance_events")
    .select("id,event_date,event_type,reason,student_number,lesson_id,notion_page_id,lessons(label,start_time,campus,source_payload)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as EventWithLesson | null;
}

async function syncNotion(supabase: ReturnType<typeof createSupabaseAdminClient>, event: EventWithLesson) {
  const { data: profile, error: profileError } = await supabase
    .from("notion_student_profiles")
    .select("notion_page_id")
    .eq("student_number", event.student_number)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.notion_page_id) throw new Error("Notion生徒情報DBと紐づいていない生徒です");
  const notionPageId = await upsertAttendanceNotionPage({
    event,
    profilePageId: profile.notion_page_id as string,
    notionPageId: event.notion_page_id,
  });
  const { data, error } = await supabase
    .from("attendance_events")
    .update({ notion_page_id: notionPageId, notion_status: "success", notion_error: null })
    .eq("id", event.id)
    .select("*,student_roster(student_name,grade,campus,homeroom_teacher),lessons(label,lesson_date,start_time,campus,classroom,subject,class_name)")
    .single();
  if (error) throw error;
  return data;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  let update: ReturnType<typeof parseUpdate>;
  try {
    update = parseUpdate(body as Record<string, unknown>);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  const supabase = createSupabaseAdminClient();
  const [rosterResult, lessonResult, enrollmentResult] = await Promise.all([
    supabase.from("student_roster").select("campus").eq("student_number", update.student_number).maybeSingle(),
    supabase.from("lessons").select("lesson_date,campus,grade,subject,class_name").eq("id", update.lesson_id).maybeSingle(),
    supabase.from("student_class_enrollments").select("grade,subject,class_name,classroom").eq("student_number", update.student_number),
  ]);
  if (rosterResult.error) return NextResponse.json({ error: rosterResult.error.message }, { status: 500 });
  if (lessonResult.error) return NextResponse.json({ error: lessonResult.error.message }, { status: 500 });
  if (enrollmentResult.error) return NextResponse.json({ error: enrollmentResult.error.message }, { status: 500 });
  if (!lessonResult.data) return NextResponse.json({ error: "選択した授業を確認できません" }, { status: 400 });
  if (lessonResult.data.lesson_date !== update.event_date) {
    return NextResponse.json({ error: `対象日（${update.event_date}）と選択した授業の日付（${lessonResult.data.lesson_date}）が一致しません` }, { status: 400 });
  }
  const campusValidation = validateAttendanceCampusSelection({
    studentCampus: rosterResult.data?.campus,
    lessonCampus: lessonResult.data.campus,
    requestedCampus: lessonResult.data.campus,
    enrollmentCampus: enrollmentCampusForLesson(enrollmentResult.data, lessonResult.data),
    crossCampusOverride: update.cross_campus_override,
    crossCampusReason: update.cross_campus_reason,
  });
  if (!campusValidation.ok) return NextResponse.json({ error: campusValidation.error }, { status: 400 });
  const { data: before } = await supabase.from("attendance_events").select("*").eq("id", id).maybeSingle();
  const { data, error } = await supabase
    .from("attendance_events")
    .update(update)
    .eq("id", id)
    .in("contact_method", ["phone", "oral", "other"])
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "手入力データが見つかりません" }, { status: 404 });
  await supabase.from("attendance_event_audit_logs").insert({
    event_id: id,
    action: "manual_update",
    actor: update.received_by,
    before_data: before,
    after_data: data,
  });

  const event = await fetchEvent(supabase, id);
  if (!event) return NextResponse.json({ error: "手入力データが見つかりません" }, { status: 404 });
  try {
    const synced = await syncNotion(supabase, event);
    return NextResponse.json({ ok: true, event: synced, notion_failed: false });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await supabase.from("attendance_events").update({ notion_status: "failed", notion_error: message.slice(0, 500) }).eq("id", id);
    return NextResponse.json({ ok: true, event: data, notion_failed: true, notion_error: message.slice(0, 500) });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const cancelledBy = cleanText((body as Record<string, unknown>).cancelled_by);
  const supabase = createSupabaseAdminClient();
  const { data: before, error: beforeError } = await supabase
    .from("attendance_events")
    .select("*")
    .eq("id", id)
    .in("contact_method", ["phone", "oral", "other"])
    .maybeSingle();
  if (beforeError) return NextResponse.json({ error: beforeError.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: "手入力データが見つかりません" }, { status: 404 });

  let notionError: string | null = null;
  if (before.notion_page_id) {
    try {
      await archiveAttendanceNotionPage(before.notion_page_id as string);
    } catch (cause) {
      notionError = cause instanceof Error ? cause.message : String(cause);
    }
  }
  const { data, error } = await supabase
    .from("attendance_events")
    .update({
      status: "cancelled",
      cancelled_by: cancelledBy,
      cancelled_at: new Date().toISOString(),
      notion_status: notionError ? "failed" : before.notion_page_id ? "success" : before.notion_status,
      notion_error: notionError ? notionError.slice(0, 500) : null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from("attendance_event_audit_logs").insert({
    event_id: id,
    action: "manual_cancel",
    actor: cancelledBy,
    before_data: before,
    after_data: data,
  });
  return NextResponse.json({ ok: true, event: data, notion_failed: Boolean(notionError), notion_error: notionError });
}
