import { NextResponse } from "next/server";
import { getLineBotInfo, readLineResponse } from "@/lib/line-send-audit";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const sentBy = typeof body.sent_by === "string" ? body.sent_by.trim() : "";
  if (!text) return NextResponse.json({ error: "返信文を入力してください" }, { status: 400 });
  if (text.length > 5000) return NextResponse.json({ error: "返信文は5000文字以内で入力してください" }, { status: 400 });
  if (!sentBy) return NextResponse.json({ error: "画面上部の確認者名を入力してください" }, { status: 400 });

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: "LINE_CHANNEL_ACCESS_TOKEN not configured" }, { status: 500 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: candidate, error } = await supabase
    .from("attendance_candidates")
    .select("id,source_message_id,status,line_messages(line_user_id,display_name)")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!candidate) return NextResponse.json({ error: "候補が見つかりません" }, { status: 404 });

  const lineMessage = Array.isArray(candidate.line_messages) ? candidate.line_messages[0] : candidate.line_messages;
  const lineUserId = lineMessage?.line_user_id;
  if (!lineUserId) return NextResponse.json({ error: "返信先のLINEユーザーIDが見つかりません" }, { status: 400 });

  const botInfo = await getLineBotInfo(accessToken);
  const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: "text", text }],
    }),
  });

  const lineRequestId = lineRes.headers.get("x-line-request-id");
  const lineResponse = await readLineResponse(lineRes);
  if (!lineRes.ok) {
    console.error("LINE attendance reply error", lineResponse);
    return NextResponse.json({ error: "LINE API error", details: lineResponse }, { status: 502 });
  }

  const now = new Date().toISOString();
  const { data: savedMessage, error: saveError } = await supabase.from("line_messages").insert({
    line_message_id: `attendance_reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    line_user_id: lineUserId,
    direction: "outbound",
    message_type: "text",
    text,
    sent_by: sentBy,
    received_at: now,
    raw_event: {
      audit_version: 1,
      operation: "push",
      send_context: "attendance_candidate_reply",
      attendance_candidate_id: id,
      source_message_id: candidate.source_message_id,
      target_display_name: lineMessage?.display_name ?? null,
      line_request_id: lineRequestId,
      line_http_status: lineRes.status,
      line_response: lineResponse,
      bot_user_id: botInfo?.userId ?? null,
      bot_basic_id: botInfo?.basicId ?? null,
      bot_display_name: botInfo?.displayName ?? null,
      line_accepted_at: now,
    },
  }).select("id,line_user_id,direction,text,message_type,received_at,created_at,sent_by").single();

  if (saveError) {
    console.error("Failed to save attendance reply", saveError);
    return NextResponse.json({
      error: "LINE_SENT_HISTORY_SAVE_FAILED",
      message: "LINEへの送信は完了しましたが、送信履歴を保存できませんでした。再送しないでください。",
      line_delivered: true,
      line_request_id: lineRequestId,
    }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: savedMessage, audit_id: savedMessage.id, line_request_id: lineRequestId, history_saved: true });
}