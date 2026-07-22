import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const allowed = ["student_number", "event_type", "event_date", "lesson_id", "suggested_subject", "suggested_class_name", "ai_summary"];
  const update = Object.fromEntries(allowed.filter((key) => key in body).map((key) => [key, body[key] || null]));
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("attendance_candidates").update(update).eq("id", id).in("status", ["pending", "notion_failed"]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ candidate: data });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("attendance_candidates").update({ status: "dismissed" }).eq("id", id).in("status", ["pending", "notion_failed"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
