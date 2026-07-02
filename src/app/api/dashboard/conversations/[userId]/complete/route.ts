import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { userId } = await context.params;
  const supabase = createSupabaseAdminClient();

  // このユーザーのメッセージ ID を取得
  const { data: msgs, error: msgsErr } = await supabase
    .from("line_messages")
    .select("id")
    .eq("line_user_id", userId);

  if (msgsErr) return NextResponse.json({ error: msgsErr.message }, { status: 500 });

  const messageIds = (msgs ?? []).map((m) => m.id as string);
  if (messageIds.length === 0) return NextResponse.json({ ok: true });

  const { error } = await supabase
    .from("ai_message_routes")
    .update({ handled_status: "done", handled_at: new Date().toISOString() })
    .in("message_id", messageIds)
    .eq("handled_status", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
