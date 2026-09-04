import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { id?: string; studentNumber?: string } | null;
  if (!body?.id || !body.studentNumber?.trim()) return NextResponse.json({ error: "キャンセル内容を正しく指定してください。" }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("study_room_reservations").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", body.id).eq("student_number", body.studentNumber.trim()).eq("status", "active");
  if (error) return NextResponse.json({ error: "キャンセルに失敗しました。" }, { status: 500 });
  return NextResponse.json({ cancelled: true });
}
