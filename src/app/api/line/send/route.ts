import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import {
  getLineBotInfo,
  readLineResponse,
} from "@/lib/line-send-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { line_user_id, text, sent_by, send_context } = (body ?? {}) as Record<string, string>;

  if (!line_user_id || !text?.trim()) {
    return NextResponse.json({ error: "line_user_id and text are required" }, { status: 400 });
  }

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: "LINE_CHANNEL_ACCESS_TOKEN not configured" }, { status: 500 });
  }

  const trimmedText = text.trim();
  const botInfo = await getLineBotInfo(accessToken);

  const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: line_user_id,
      messages: [{ type: "text", text: trimmedText }],
    }),
  });

  const lineRequestId = lineRes.headers.get("x-line-request-id");
  const lineResponse = await readLineResponse(lineRes);

  if (!lineRes.ok) {
    console.error("LINE send error", lineResponse);
    return NextResponse.json({ error: "LINE API error", details: lineResponse }, { status: 502 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: savedMessage, error } = await supabase.from("line_messages").insert({
    line_message_id: `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    line_user_id,
    direction: "outbound",
    message_type: "text",
    text: trimmedText,
    sent_by: sent_by?.trim() || null,
    received_at: new Date().toISOString(),
    raw_event: {
      audit_version: 1,
      operation: "push",
      send_context: send_context || null,
      line_request_id: lineRequestId,
      line_http_status: lineRes.status,
      line_response: lineResponse,
      bot_user_id: botInfo?.userId ?? null,
      bot_basic_id: botInfo?.basicId ?? null,
      bot_display_name: botInfo?.displayName ?? null,
      line_accepted_at: new Date().toISOString(),
    },
  }).select("id").single();

  if (error) {
    console.error("Failed to save outbound message", error);
  }

  return NextResponse.json({
    ok: true,
    audit_id: savedMessage?.id ?? null,
    line_request_id: lineRequestId,
    history_saved: !error,
  });
}
