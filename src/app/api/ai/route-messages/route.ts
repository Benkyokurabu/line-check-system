import "server-only";

import { NextResponse } from "next/server";

import { requireInternalToken } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AppSettings = {
  ai_model?: string;
  teacher_notify_confidence_threshold?: number;
  teacher_direct_confidence_threshold?: number;
  conversation_lookback_hours?: number;
  conversation_lookback_message_count?: number;
};

type Teacher = {
  id: string;
  display_name: string;
  aliases: string[];
  notification_channel: "teams" | "email" | "none";
  notification_target: string | null;
  notify_confidence_threshold: number | null;
  direct_confidence_threshold: number | null;
};

type LineMessage = {
  id: string;
  line_user_id: string;
  display_name: string | null;
  text: string | null;
  received_at: string | null;
  created_at: string;
};

type AiRoute = {
  teacher_name: string;
  confidence: number;
  reason?: string;
  matched_alias?: string;
  topic?: string;
  is_continuation?: boolean;
};

async function loadSettings(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
): Promise<AppSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("key,value");

  if (error) throw error;

  return Object.fromEntries(
    (data ?? []).map((row: { key: string; value: unknown }) => [
      row.key,
      row.value,
    ]),
  ) as AppSettings;
}

function numberSetting(
  settings: AppSettings,
  key: keyof AppSettings,
  fallback: number,
) {
  const value = settings[key];
  return typeof value === "number" ? value : fallback;
}

async function callGroq(params: {
  model: string;
  message: LineMessage;
  thread: LineMessage[];
  teachers: Teacher[];
}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You route Japanese cram-school LINE messages to teachers. Return compact JSON only. " +
            "Prefer recall over precision, but do not invent teachers that are not in the teacher list.",
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction:
              "Decide which teachers may need to see the new message. Use explicit teacher names, aliases, and recent conversation context. Return {routes:[{teacher_name,confidence,reason,matched_alias,topic,is_continuation}]} with confidence 0..1.",
            teachers: params.teachers.map((teacher) => ({
              name: teacher.display_name,
              aliases: teacher.aliases,
            })),
            recent_thread: params.thread.map((message) => ({
              text: message.text,
              display_name: message.display_name,
              received_at: message.received_at,
            })),
            new_message: {
              text: params.message.text,
              display_name: params.message.display_name,
              received_at: params.message.received_at,
            },
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq request failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Groq response did not include text content");
  }

  const parsed = JSON.parse(content) as { routes?: AiRoute[] };
  return Array.isArray(parsed.routes) ? parsed.routes : [];
}

function routeType(confidence: number, directThreshold: number) {
  return confidence >= directThreshold ? "direct" : "candidate";
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

  const supabase = createSupabaseAdminClient();
  const settings = await loadSettings(supabase);
  const model =
    typeof settings.ai_model === "string"
      ? settings.ai_model
      : "openai/gpt-oss-120b";
  const notifyThreshold = numberSetting(
    settings,
    "teacher_notify_confidence_threshold",
    0.45,
  );
  const directThreshold = numberSetting(
    settings,
    "teacher_direct_confidence_threshold",
    0.75,
  );
  const lookbackHours = numberSetting(settings, "conversation_lookback_hours", 72);
  const lookbackMessageCount = numberSetting(
    settings,
    "conversation_lookback_message_count",
    10,
  );

  const { data: teachers, error: teachersError } = await supabase
    .from("teachers")
    .select(
      "id,display_name,aliases,notification_channel,notification_target,notify_confidence_threshold,direct_confidence_threshold",
    )
    .eq("notification_enabled", true);

  if (teachersError) throw teachersError;
  if (!teachers?.length) {
    return NextResponse.json({ processed: 0, reason: "no teachers configured" });
  }

  const { data: messages, error: messagesError } = await supabase
    .from("line_messages")
    .select("id,line_user_id,display_name,text,received_at,created_at")
    .eq("direction", "inbound")
    .not("text", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit * 3);

  if (messagesError) throw messagesError;

  const messageIds = (messages ?? []).map((message: LineMessage) => message.id);
  const { data: existingRoutes, error: existingRoutesError } = await supabase
    .from("ai_message_routes")
    .select("message_id")
    .in("message_id", messageIds.length ? messageIds : ["00000000-0000-0000-0000-000000000000"]);

  if (existingRoutesError) throw existingRoutesError;

  const routedMessageIds = new Set(
    (existingRoutes ?? []).map((route: { message_id: string }) => route.message_id),
  );
  const pending = (messages ?? [])
    .filter((message: LineMessage) => !routedMessageIds.has(message.id))
    .slice(0, limit);

  let routeCount = 0;
  let notificationCount = 0;

  for (const message of pending as LineMessage[]) {
    const since = new Date(
      new Date(message.received_at ?? message.created_at).getTime() -
        lookbackHours * 60 * 60 * 1000,
    ).toISOString();

    const { data: thread, error: threadError } = await supabase
      .from("line_messages")
      .select("id,line_user_id,display_name,text,received_at,created_at")
      .eq("line_user_id", message.line_user_id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(lookbackMessageCount);

    if (threadError) throw threadError;

    const aiRoutes = await callGroq({
      model,
      message,
      thread: (thread ?? []).reverse() as LineMessage[],
      teachers: teachers as Teacher[],
    });

    for (const aiRoute of aiRoutes) {
      const teacher = (teachers as Teacher[]).find(
        (item) => item.display_name === aiRoute.teacher_name,
      );
      const confidence = Math.max(0, Math.min(1, Number(aiRoute.confidence) || 0));
      const teacherNotifyThreshold =
        teacher?.notify_confidence_threshold ?? notifyThreshold;
      const teacherDirectThreshold =
        teacher?.direct_confidence_threshold ?? directThreshold;

      if (confidence < teacherNotifyThreshold) continue;

      const { data: savedRoute, error: routeError } = await supabase
        .from("ai_message_routes")
        .upsert(
          {
            message_id: message.id,
            line_user_id: message.line_user_id,
            teacher_id: teacher?.id ?? null,
            teacher_name: aiRoute.teacher_name,
            confidence,
            route_type: routeType(confidence, teacherDirectThreshold),
            matched_alias: aiRoute.matched_alias ?? null,
            reason: aiRoute.reason ?? null,
            topic: aiRoute.topic ?? null,
            is_continuation: aiRoute.is_continuation ?? null,
            prompt_version: "teacher-routing-v1",
            model,
            raw_result: aiRoute,
          },
          { onConflict: "message_id,teacher_name" },
        )
        .select("id")
        .single();

      if (routeError) throw routeError;
      routeCount += 1;

      const notificationType =
        confidence >= teacherDirectThreshold ? "immediate" : "digest";
      const { error: notificationError } = await supabase
        .from("teacher_notifications")
        .upsert(
          {
            message_id: message.id,
            route_id: savedRoute.id,
            teacher_id: teacher?.id ?? null,
            teacher_name: aiRoute.teacher_name,
            notification_type: notificationType,
            channel: teacher?.notification_channel ?? "teams",
            target: teacher?.notification_target ?? process.env.TEAMS_WEBHOOK_URL ?? null,
            status: "pending",
            payload: {
              message_text: message.text,
              received_at: message.received_at,
              confidence,
              reason: aiRoute.reason ?? null,
              topic: aiRoute.topic ?? null,
            },
          },
          { onConflict: "message_id,teacher_name,notification_type" },
        );

      if (notificationError) throw notificationError;
      notificationCount += 1;
    }
  }

  return NextResponse.json({
    processed: pending.length,
    routes: routeCount,
    notifications: notificationCount,
  });
}
