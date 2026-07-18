import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import {
  getLineBotInfo,
  readLineResponse,
} from "@/lib/line-send-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MULTICAST_CHUNK_SIZE = 500; // LINE multicast API の上限

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { group_name, text, sent_by } = (body ?? {}) as Record<string, string>;

  if (!group_name?.trim() || !text?.trim()) {
    return NextResponse.json({ error: "group_name and text are required" }, { status: 400 });
  }

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: "LINE_CHANNEL_ACCESS_TOKEN not configured" }, { status: 500 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: members, error: membersErr } = await supabase
    .from("line_user_aliases")
    .select("line_user_id")
    .eq("group_name", group_name.trim());

  if (membersErr) return NextResponse.json({ error: membersErr.message }, { status: 500 });

  const lineUserIds = (members ?? []).map((m) => m.line_user_id as string);
  if (lineUserIds.length === 0) {
    return NextResponse.json({ error: "このグループに登録されている生徒がいません" }, { status: 400 });
  }

  const trimmedText = text.trim();
  const botInfo = await getLineBotInfo(accessToken);
  const lineRequestIds: string[] = [];

  for (let i = 0; i < lineUserIds.length; i += MULTICAST_CHUNK_SIZE) {
    const chunk = lineUserIds.slice(i, i + MULTICAST_CHUNK_SIZE);
    const lineRes = await fetch("https://api.line.me/v2/bot/message/multicast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: chunk,
        messages: [{ type: "text", text: trimmedText }],
      }),
    });

    const requestId = lineRes.headers.get("x-line-request-id");
    if (requestId) lineRequestIds.push(requestId);
    const lineResponse = await readLineResponse(lineRes);

    if (!lineRes.ok) {
      console.error("LINE multicast error", lineResponse);
      return NextResponse.json({ error: "LINE API error", details: lineResponse }, { status: 502 });
    }
  }

  const now = new Date().toISOString();
  const { data: savedMessages, error: insertErr } = await supabase.from("line_messages").insert(
    lineUserIds.map((lineUserId, idx) => ({
      line_message_id: `bcast_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 8)}`,
      line_user_id: lineUserId,
      direction: "outbound",
      message_type: "text",
      text: trimmedText,
      sent_by: sent_by?.trim() || null,
      received_at: now,
      raw_event: {
        audit_version: 1,
        operation: "multicast",
        group_name: group_name.trim(),
        target_count: lineUserIds.length,
        line_request_ids: lineRequestIds,
        line_http_status: 200,
        bot_user_id: botInfo?.userId ?? null,
        bot_basic_id: botInfo?.basicId ?? null,
        bot_display_name: botInfo?.displayName ?? null,
        line_accepted_at: now,
      },
    })),
  ).select("id");

  if (insertErr) {
    console.error("Failed to save broadcast messages", insertErr);
    return NextResponse.json(
      {
        error: "LINE_SENT_HISTORY_SAVE_FAILED",
        message: "一斉送信は完了しましたが、送信履歴を保存できませんでした。再送せず管理者へ確認してください。",
        line_delivered: true,
        sent: lineUserIds.length,
        line_request_ids: lineRequestIds,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    sent: lineUserIds.length,
    audit_ids: savedMessages.map((message) => message.id),
    line_request_ids: lineRequestIds,
    history_saved: true,
  });
}
