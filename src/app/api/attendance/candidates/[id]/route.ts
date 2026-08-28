import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

const eventTypes = new Set(["absence", "late", "early_leave", "reschedule_request", "other"]);

function cleanDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanEventType(value: unknown) {
  return typeof value === "string" && eventTypes.has(value) ? value : "other";
}

function cleanUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 80) {
    return NextResponse.json({ error: "登録行は1〜80件で指定してください" }, { status: 400 });
  }
  const candidate = {
    student_number: cleanText(body.student_number),
    event_type: cleanEventType(body.event_type),
    event_date: cleanDate(body.event_date),
    lesson_id: cleanText(body.lesson_id),
    ai_summary: cleanText(body.ai_summary),
  };
  const items = body.items.map((item: Record<string, unknown>) => ({
    id: cleanUuid(item.id),
    student_number: cleanText(item.student_number),
    event_type: cleanEventType(item.event_type),
    event_date: cleanDate(item.event_date),
    lesson_id: cleanText(item.lesson_id),
    suggested_subject: cleanText(item.suggested_subject),
    suggested_class_name: cleanText(item.suggested_class_name),
    ai_summary: cleanText(item.ai_summary),
    arrival_expected_time: cleanText(item.arrival_expected_time),
    note_internal: cleanText(item.note_internal),
    note_for_classroom: cleanText(item.note_for_classroom),
    cross_campus_override: item.cross_campus_override === true,
    cross_campus_reason: cleanText(item.cross_campus_reason),
  }));
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc("replace_attendance_candidate_draft", {
    p_candidate_id: id,
    p_candidate: candidate,
    p_items: items,
  });
  if (error) {
    const status = error.code === "P0001" ? 409 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  const { data, error: readError } = await supabase.from("attendance_candidates").select("*").eq("id", id).single();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  return NextResponse.json({ candidate: data });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const actor = cleanText(body.dismissed_by);
  if (!actor) return NextResponse.json({ error: "確認者名を入力してください" }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("dismiss_attendance_candidate", {
    p_candidate_id: id,
    p_actor: actor,
  });
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "P0001" ? 409 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ ok: true, already_dismissed: data === false });
}
