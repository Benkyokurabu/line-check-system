import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { teacherNameVariants } from "@/lib/teacher-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { userId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const teacherName = typeof body.teacher_name === "string" ? body.teacher_name.trim() : "";

  if (!teacherName) {
    return NextResponse.json({ error: "teacher_name is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  // このユーザーのメッセージ ID を取得
  const { data: msgs, error: msgsErr } = await supabase
    .from("line_messages")
    .select("id")
    .eq("line_user_id", userId);

  if (msgsErr) return NextResponse.json({ error: msgsErr.message }, { status: 500 });

  const messageIds = (msgs ?? []).map((m) => m.id as string);
  if (messageIds.length === 0) return NextResponse.json({ ok: true });

  // 自分（teacherName）宛のルートだけを完了扱いにする。
  // 他の先生宛のルートには一切触れない — 触れると、二人の先生に振られたメッセージが
  // 片方の「完了」操作でもう片方から見えなくなってしまう。
  const { error } = await supabase
    .from("ai_message_routes")
    .update({ handled_status: "done", handled_at: new Date().toISOString() })
    .in("message_id", messageIds)
    .in("teacher_name", teacherNameVariants(teacherName))
    .eq("handled_status", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
