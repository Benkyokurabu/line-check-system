import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

const eventTypes = new Set(["absence", "late", "reschedule_request", "other"]);

function cleanDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanEventType(value: unknown) {
  return typeof value === "string" && eventTypes.has(value) ? value : "other";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const allowed = ["student_number", "event_type", "event_date", "lesson_id", "suggested_subject", "suggested_class_name", "ai_summary"];
  const update = Object.fromEntries(allowed.filter((key) => key in body).map((key) => [key, body[key] || null]));
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("attendance_candidates").update(update).eq("id", id).in("status", ["pending", "notion_failed"]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(body.items)) {
    const rows = body.items.slice(0, 80).map((item: Record<string, unknown>) => ({
      candidate_id: id,
      event_type: cleanEventType(item.event_type),
      event_date: cleanDate(item.event_date),
      lesson_id: cleanText(item.lesson_id),
      suggested_subject: cleanText(item.suggested_subject),
      suggested_class_name: cleanText(item.suggested_class_name),
      ai_summary: cleanText(item.ai_summary),
      status: "pending",
    }));
    const { error: deleteError } = await supabase
      .from("attendance_candidate_items")
      .delete()
      .eq("candidate_id", id)
      .in("status", ["pending", "notion_failed"]);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("attendance_candidate_items").insert(rows);
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ candidate: data });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("attendance_candidates").update({ status: "dismissed" }).eq("id", id).in("status", ["pending", "notion_failed"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from("attendance_candidate_items").update({ status: "dismissed" }).eq("candidate_id", id).in("status", ["pending", "notion_failed"]);
  return NextResponse.json({ ok: true });
}
