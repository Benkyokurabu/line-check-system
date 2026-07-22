import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("attendance_candidates")
    .select("*,student_roster(student_name,grade,campus),lessons(label,lesson_date,start_time,campus),line_messages(text,received_at,display_name)")
    .in("status", status === "pending" ? ["pending", "notion_failed"] : [status])
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ candidates: data ?? [] });
}
