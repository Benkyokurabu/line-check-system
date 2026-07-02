import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { line_user_id, text, sent_by } = (body ?? {}) as Record<string, string>;

  if (!line_user_id || !text?.trim()) {
    return NextResponse.json({ error: "line_user_id and text are required" }, { status: 400 });
  }

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: "LINE_CHANNEL_ACCESS_TOKEN not configured" }, { status: 500 });
  }

  const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: line_user_id,
      messages: [{ type: "text", text: text.trim() }],
    }),
  });

  if (!lineRes.ok) {
    const err = await lineRes.json().catch(() => ({}));
    console.error("LINE send error", err);
    return NextResponse.json({ error: "LINE API error", details: err }, { status: 502 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("line_messages").insert({
    line_message_id: `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    line_user_id,
    direction: "outbound",
    message_type: "text",
    text: text.trim(),
    sent_by: sent_by?.trim() || null,
    received_at: new Date().toISOString(),
    raw_event: null,
  });

  if (error) console.error("Failed to save outbound message", error);

  return NextResponse.json({ ok: true });
}
