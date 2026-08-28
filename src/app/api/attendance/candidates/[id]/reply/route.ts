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
  const allowAdditional = body.allow_additional === true;
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

  const { data: existingReply, error: existingReplyError } = await supabase
    .from("line_messages")
    .select("id")
    .eq("direction", "outbound")
    .eq("raw_event->>send_context", "attendance_candidate_reply")
    .eq("raw_event->>attendance_candidate_id", id)
    .limit(1)
    .maybeSingle();
  if (existingReplyError) return NextResponse.json({ error: existingReplyError.message }, { status: 500 });
  if (existingReply && !allowAdditional) {
    return NextResponse.json({
      error: "LINE_ALREADY_SENT",
      message: "この欠席連絡にはLINEで送信済みです。別のメッセージを送る場合は専用ボタンを使用してください。",
      already_sent: true,
    }, { status: 409 });
  }

  const replyKind = existingReply ? "additional" : "initial";
  const claimTime = new Date().toISOString();
  const claimRawEvent = {
    audit_version: 2,
    operation: "push",
    send_context: "attendance_candidate_reply",
    reply_kind: replyKind,
    send_status: "sending",
    attendance_candidate_id: id,
    source_message_id: candidate.source_message_id,
    target_display_name: lineMessage?.display_name ?? null,
    claimed_at: claimTime,
  };
  const claimLineMessageId = replyKind === "initial"
    ? `attendance_reply_initial_${id}`
    : `attendance_reply_additional_${crypto.randomUUID()}`;
  const claimResult = await supabase.from("line_messages").insert({
    line_message_id: claimLineMessageId,
    line_user_id: lineUserId,
    direction: "outbound",
    message_type: "text",
    text,
    sent_by: sentBy,
    received_at: claimTime,
    raw_event: claimRawEvent,
  }).select("id,line_user_id,direction,text,message_type,received_at,created_at,sent_by").single();
  if (claimResult.error) {
    if (replyKind === "initial" && claimResult.error.code === "23505") {
      return NextResponse.json({
        error: "LINE_ALREADY_SENT",
        message: "この欠席連絡は送信済み、または別の送信処理が進行中です。",
        already_sent: true,
      }, { status: 409 });
    }
    return NextResponse.json({ error: claimResult.error.message }, { status: 500 });
  }
  const claim = claimResult.data;

  const botInfo = await getLineBotInfo(accessToken);
  let lineRes: Response;
  try {
    lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
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
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await supabase.from("line_messages").update({
      raw_event: {
        ...claimRawEvent,
        send_status: "unknown",
        failure_stage: "response_wait",
        error: message.slice(0, 500),
      },
    }).eq("id", claim.id);
    return NextResponse.json({
      error: "LINE_DELIVERY_UNKNOWN",
      message: "LINEの送信結果を確認できませんでした。二重送信を防ぐため再送せず、LINE管理画面で送信履歴を確認してください。",
      line_delivery_unknown: true,
    }, { status: 502 });
  }

  const lineRequestId = lineRes.headers.get("x-line-request-id");
  const lineResponse = await readLineResponse(lineRes);
  if (!lineRes.ok) {
    console.error("LINE attendance reply error", lineResponse);
    await supabase.from("line_messages").delete().eq("id", claim.id);
    return NextResponse.json({ error: "LINE API error", details: lineResponse }, { status: 502 });
  }

  const now = new Date().toISOString();
  const finalRawEvent = {
      audit_version: 2,
      operation: "push",
      send_context: "attendance_candidate_reply",
      reply_kind: replyKind,
      send_status: "accepted",
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
    };
  const saveResult = await supabase.from("line_messages")
    .update({ received_at: now, raw_event: finalRawEvent })
    .eq("id", claim.id)
    .select("id,line_user_id,direction,text,message_type,received_at,created_at,sent_by")
    .single();
  const { data: savedMessage, error: saveError } = saveResult;

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
