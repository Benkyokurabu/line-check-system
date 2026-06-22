import "server-only";

import { NextResponse } from "next/server";

import { requireInternalToken } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PendingNotification = {
  id: string;
  teacher_name: string;
  notification_type: "immediate" | "digest" | "manual";
  target: string | null;
  payload: {
    message_text?: string;
    received_at?: string;
    confidence?: number;
    reason?: string;
    topic?: string;
  } | null;
};

function buildMessage(notification: PendingNotification) {
  const payload = notification.payload ?? {};
  const confidence =
    typeof payload.confidence === "number"
      ? `${Math.round(payload.confidence * 100)}%`
      : "不明";

  return [
    `${notification.teacher_name}宛の可能性があるLINEです`,
    "",
    `通知種別: ${notification.notification_type}`,
    `受信時刻: ${payload.received_at ?? "不明"}`,
    `信頼度: ${confidence}`,
    payload.topic ? `話題: ${payload.topic}` : null,
    payload.reason ? `理由: ${payload.reason}` : null,
    "",
    payload.message_text ? `本文: ${payload.message_text}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function postToTeams(url: string, text: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Teams webhook failed: ${response.status}`);
  }
}

export async function POST(request: Request) {
  if (!requireInternalToken(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(
    Math.max(Number.isFinite(body.limit) ? Number(body.limit) : 10, 1),
    50,
  );
  const notificationType =
    body.notification_type === "digest" ||
    body.notification_type === "manual" ||
    body.notification_type === "immediate"
      ? body.notification_type
      : undefined;

  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("teacher_notifications")
    .select("id,teacher_name,notification_type,target,payload")
    .eq("status", "pending")
    .eq("channel", "teams")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (notificationType) {
    query = query.eq("notification_type", notificationType);
  }

  const { data, error } = await query;
  if (error) throw error;

  let sent = 0;
  let failed = 0;

  for (const notification of (data ?? []) as PendingNotification[]) {
    const target = notification.target ?? process.env.TEAMS_WEBHOOK_URL;
    if (!target) {
      await supabase
        .from("teacher_notifications")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          error_message: "Teams webhook URL is not configured",
        })
        .eq("id", notification.id);
      failed += 1;
      continue;
    }

    try {
      await postToTeams(target, buildMessage(notification));
      await supabase
        .from("teacher_notifications")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", notification.id);
      sent += 1;
    } catch (err) {
      await supabase
        .from("teacher_notifications")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          error_message: err instanceof Error ? err.message : "Unknown error",
        })
        .eq("id", notification.id);
      failed += 1;
    }
  }

  return NextResponse.json({ checked: data?.length ?? 0, sent, failed });
}
