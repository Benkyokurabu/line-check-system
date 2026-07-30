import { NextResponse } from "next/server";
import { upsertAttendanceNotionPage, type AttendanceNotionEvent } from "@/lib/attendance-notion";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contactMethods = new Set(["line", "phone", "oral", "other"]);
const eventTypes = new Set(["absence", "late", "early_leave"]);
const manualContactMethods = ["phone", "oral", "other"];

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

function cleanReceivedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

type ManualEventInput = Record<string, unknown>;
type EventWithLesson = AttendanceNotionEvent & {
  id: string;
  notion_page_id: string | null;
  lessons: AttendanceNotionEvent["lessons"];
};

function parseEvent(input: ManualEventInput, common: Record<string, unknown>) {
  const studentNumber = cleanText(input.student_number);
  const lessonId = cleanText(input.lesson_id);
  const eventDate = cleanDate(input.event_date);
  const receivedBy = cleanText(input.received_by ?? common.received_by);
  if (!studentNumber) throw new Error("生徒を選択してください");
  if (!lessonId) throw new Error("授業を選択してください");
  if (!eventDate) throw new Error("対象日を入力してください");
  return {
    contact_method: cleanContactMethod(input.contact_method ?? common.contact_method),
    contact_received_at: cleanReceivedAt(input.contact_received_at ?? common.contact_received_at),
    received_by: receivedBy,
    student_number: studentNumber,
    lesson_id: lessonId,
    event_date: eventDate,
    event_type: cleanEventType(input.event_type),
    reason: cleanText(input.reason),
    arrival_expected_time: cleanText(input.arrival_expected_time),
    note_internal: cleanText(input.note_internal),
    note_for_classroom: cleanText(input.note_for_classroom),
    status: "confirmed",
    confirmed_by: receivedBy,
    confirmed_at: new Date().toISOString(),
    cancelled_by: null,
    cancelled_at: null,
    notion_status: "pending",
    notion_error: null,
  };
}

async function attachNotionPages(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  events: EventWithLesson[];
}) {
  if (input.events.length === 0) return [];
  const studentNumbers = [...new Set(input.events.map((event) => event.student_number))];
  const { data: profiles, error: profileError } = await input.supabase
    .from("notion_student_profiles")
    .select("student_number,notion_page_id")
    .in("student_number", studentNumbers);
  if (profileError) throw profileError;
  const profileByStudent = new Map((profiles ?? []).map((profile) => [profile.student_number as string, profile.notion_page_id as string]));
  const results: Array<{ id: string; notion_page_id: string | null; notion_status: "success" | "failed"; notion_error: string | null }> = [];

  for (const event of input.events) {
    const profilePageId = profileByStudent.get(event.student_number);
    if (!profilePageId) {
      const message = "Notion生徒情報DBと紐づいていない生徒です";
      await input.supabase.from("attendance_events").update({ notion_status: "failed", notion_error: message }).eq("id", event.id);
      results.push({ id: event.id, notion_page_id: null, notion_status: "failed", notion_error: message });
      continue;
    }
    try {
      const notionPageId = await upsertAttendanceNotionPage({
        event,
        profilePageId,
        notionPageId: event.notion_page_id,
      });
      await input.supabase.from("attendance_events").update({
        notion_page_id: notionPageId,
        notion_status: "success",
        notion_error: null,
      }).eq("id", event.id);
      results.push({ id: event.id, notion_page_id: notionPageId, notion_status: "success", notion_error: null });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await input.supabase.from("attendance_events").update({
        notion_status: "failed",
        notion_error: message.slice(0, 500),
      }).eq("id", event.id);
      results.push({ id: event.id, notion_page_id: event.notion_page_id, notion_status: "failed", notion_error: message.slice(0, 500) });
    }
  }
  return results;
}

async function fetchEventsByIds(supabase: ReturnType<typeof createSupabaseAdminClient>, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("attendance_events")
    .select("id,event_date,event_type,reason,student_number,lesson_id,notion_page_id,lessons(label,start_time,campus,source_payload)")
    .in("id", ids);
  if (error) throw error;
  return (data ?? []) as EventWithLesson[];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "7") || 7, 1), 60);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("attendance_events")
    .select("*,student_roster(student_name,grade,campus,homeroom_teacher),lessons(label,lesson_date,start_time,campus,classroom,subject,class_name)")
    .in("contact_method", manualContactMethods)
    .gte("event_date", since)
    .order("event_date", { ascending: false })
    .order("confirmed_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const rawEvents = Array.isArray(body.events) ? body.events : [body];
  if (rawEvents.length === 0 || rawEvents.length > 20) {
    return NextResponse.json({ error: "登録行は1〜20件で指定してください" }, { status: 400 });
  }

  let rows: ReturnType<typeof parseEvent>[];
  try {
    rows = rawEvents.map((event: unknown) => parseEvent(event as ManualEventInput, body as Record<string, unknown>));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("attendance_events")
    .upsert(rows, { onConflict: "student_number,lesson_id" })
    .select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (data?.length) {
    await supabase.from("attendance_event_audit_logs").insert(data.map((event: Record<string, unknown>) => ({
      event_id: event.id,
      action: "manual_upsert",
      actor: event.confirmed_by ?? event.received_by,
      after_data: event,
    })));
  }

  const events = await fetchEventsByIds(supabase, (data ?? []).map((event) => event.id as string));
  const notionResults = await attachNotionPages({ supabase, events });
  return NextResponse.json({
    ok: true,
    events: data ?? [],
    notion_results: notionResults,
    notion_failed: notionResults.filter((result) => result.notion_status === "failed").length,
  });
}