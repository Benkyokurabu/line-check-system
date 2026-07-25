import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contactMethods = new Set(["line", "phone", "oral", "other"]);
const eventTypes = new Set(["absence", "late", "early_leave"]);

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
    notion_status: "not_requested",
    notion_error: null,
  };
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

  return NextResponse.json({ ok: true, events: data ?? [] });
}
