import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("attendance_candidate_review_audit")
    .select("id,actor,before_student_number,after_student_number,before_lessons,after_lessons,created_at")
    .eq("candidate_id", id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ history: data ?? [] });
}
