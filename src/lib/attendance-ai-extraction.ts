import "server-only";

import { attendanceEventType, normalizeAttendanceItems, normalizeAttendanceText } from "@/lib/attendance-extract-logic.mjs";
import { createSupabaseAdminClient } from "@/lib/supabase";

type AttendanceEventType = "absence" | "late" | "reschedule_request" | "other";

type AiAttendanceItem = {
  event_type?: AttendanceEventType;
  event_date?: string;
  date_start?: string;
  date_end?: string;
  subject?: string;
  class_name?: string;
  summary?: string;
  reason?: string;
};

type AiAttendance = {
  is_attendance: boolean;
  student_name?: string;
  event_type?: AttendanceEventType;
  event_date?: string;
  date_start?: string;
  date_end?: string;
  subject?: string;
  class_name?: string;
  summary?: string;
  confidence?: number;
  reason?: string;
  items?: AiAttendanceItem[];
};

type AttendanceLineMessage = {
  id: string;
  text?: string | null;
  received_at?: string | null;
  created_at?: string | null;
  display_name?: string | null;
  attempt_count: number;
};

type RosterRow = {
  student_number: string | null;
  student_name: string | null;
  grade: string | null;
  campus: string | null;
};

const ATTENDANCE_AI_CONCURRENCY = 1;
const ATTENDANCE_MAX_ATTEMPTS = 5;
const ATTENDANCE_RETRY_DELAYS_MINUTES = [1, 5, 15, 60] as const;

function errorMessage(cause: unknown) {
  return (cause instanceof Error ? cause.message : String(cause)).slice(0, 500);
}

async function recordWorkerState(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("attendance_analysis_runtime")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("singleton", true);
  if (error) throw error;
}

async function updateReview(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  messageId: string,
  result: "candidate" | "ignored" | "failed",
  error: string | null,
) {
  const { error: reviewError } = await supabase.from("attendance_message_reviews").upsert({
    message_id: messageId,
    result,
    error_message: error,
    processed_at: new Date().toISOString(),
  });
  if (reviewError) throw reviewError;
}

async function completeJob(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  messageId: string,
  status: "succeeded" | "ignored",
) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("attendance_analysis_jobs").update({
    status,
    completed_at: now,
    locked_at: null,
    last_error: null,
  }).eq("message_id", messageId);
  if (error) throw error;
}

async function failJob(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  message: AttendanceLineMessage,
  cause: unknown,
) {
  const failure = errorMessage(cause);
  const isDead = message.attempt_count >= ATTENDANCE_MAX_ATTEMPTS;
  const retryDelay = ATTENDANCE_RETRY_DELAYS_MINUTES[
    Math.min(Math.max(message.attempt_count - 1, 0), ATTENDANCE_RETRY_DELAYS_MINUTES.length - 1)
  ];
  const nextAttemptAt = new Date(Date.now() + retryDelay * 60_000).toISOString();
  const { error: jobError } = await supabase.from("attendance_analysis_jobs").update({
    status: isDead ? "dead" : "retry_wait",
    next_attempt_at: nextAttemptAt,
    locked_at: null,
    completed_at: isDead ? new Date().toISOString() : null,
    last_error: failure,
  }).eq("message_id", message.id);
  if (jobError) console.error("Failed to update attendance analysis job", message.id, jobError);

  try {
    await updateReview(supabase, message.id, "failed", failure);
  } catch (reviewError) {
    console.error("Failed to record attendance analysis review failure", message.id, reviewError);
  }
  return isDead ? "dead" as const : "retrying" as const;
}

async function extractWithAi(input: { text: string; receivedAt: string; displayName: string | null }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not configured");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.ATTENDANCE_AI_MODEL ?? "openai/gpt-oss-120b",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "日本の学習塾へのLINEから欠席・遅刻・振替希望を抽出する。推測を確定扱いせずJSONのみ返す。今日・明日はreceived_atの日本時間を基準にYYYY-MM-DDへ直す。本文に生徒名がなければsender_display_nameも参考にする。日付範囲はdate_start/date_end、同じ日に複数授業がある場合はitemsを複数にする。",
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: "{is_attendance,student_name,confidence,items}を返す。itemsは[{event_type,event_date,date_start,date_end,subject,class_name,summary,reason}]。対象外はis_attendance=false。event_typeはabsence/late/reschedule_request/other。何日〜何日はdate_start/date_endで返す。同じ日に複数授業が書かれていれば授業ごとにitemsを分ける。生徒や日付が不明でも欠席・遅刻・振替系ならtrueにする。summaryはNotionの理由欄用に「体調不良」「交通事情」「遅刻連絡」など2〜10文字程度にする。",
            received_at: input.receivedAt,
            sender_display_name: input.displayName,
            message: input.text,
          }),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Groq request failed: ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Groq response was empty");
  return JSON.parse(content) as AiAttendance;
}

async function processAttendanceMessage(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  message: AttendanceLineMessage;
  roster: RosterRow[];
}) {
  const { supabase, message, roster } = input;
  try {
    const ai = await extractWithAi({
      text: String(message.text ?? ""),
      receivedAt: String(message.received_at ?? message.created_at),
      displayName: typeof message.display_name === "string" ? message.display_name : null,
    });
    if (!ai.is_attendance) {
      await updateReview(supabase, message.id, "ignored", null);
      await completeJob(supabase, message.id, "ignored");
      return "ignored" as const;
    }
    const items = normalizeAttendanceItems(ai);
    const firstItem = items[0];
    const student = ai.student_name
      ? roster.find((row) => normalizeAttendanceText(String(row.student_name)) === normalizeAttendanceText(ai.student_name!))
      : null;
    const confidence = Math.max(0, Math.min(1, Number(ai.confidence) || 0));
    const candidateValues = {
      source_message_id: message.id,
      student_number: student?.student_number ?? null,
      suggested_student_name: ai.student_name ?? null,
      event_type: firstItem?.event_type ?? attendanceEventType(ai.event_type),
      event_date: firstItem?.event_date ?? null,
      suggested_subject: firstItem?.suggested_subject ?? ai.subject ?? null,
      suggested_class_name: firstItem?.suggested_class_name ?? ai.class_name ?? null,
      ai_summary: firstItem?.ai_summary ?? ai.summary ?? null,
      ai_confidence: confidence,
      ai_reason: ai.reason ?? null,
      raw_ai_result: ai,
    };
    const { data: existingCandidate, error: existingError } = await supabase
      .from("attendance_candidates")
      .select("id")
      .eq("source_message_id", message.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;

    let candidateId: string;
    if (existingCandidate?.id) {
      const { data: candidate, error: updateError } = await supabase
        .from("attendance_candidates")
        .update(candidateValues)
        .eq("id", existingCandidate.id)
        .select("id")
        .single();
      if (updateError) throw updateError;
      candidateId = candidate.id;
      const { error: deleteItemsError } = await supabase
        .from("attendance_candidate_items")
        .delete()
        .eq("candidate_id", candidateId)
        .eq("status", "pending");
      if (deleteItemsError) throw deleteItemsError;
    } else {
      const { data: candidate, error: insertError } = await supabase
        .from("attendance_candidates")
        .insert(candidateValues)
        .select("id")
        .single();
      if (insertError) throw insertError;
      candidateId = candidate.id;
    }
    if (items.length > 0) {
      const { error: itemError } = await supabase.from("attendance_candidate_items").insert(items.map((item) => ({
        candidate_id: candidateId,
        event_type: item.event_type,
        event_date: item.event_date,
        suggested_subject: item.suggested_subject,
        suggested_class_name: item.suggested_class_name,
        ai_summary: item.ai_summary,
      })));
      if (itemError) throw itemError;
    }
    await updateReview(supabase, message.id, "candidate", null);
    await completeJob(supabase, message.id, "succeeded");
    return "candidate" as const;
  } catch (cause) {
    return failJob(supabase, message, cause);
  }
}

function parseAttendanceLimit(value: unknown) {
  const numericValue = Number(value);
  return Math.min(Math.max(Number.isFinite(numericValue) ? numericValue : 10, 1), 30);
}

export async function processPendingAttendanceMessages(input: { limit?: unknown; lookbackMinutes?: unknown } = {}) {
  const limit = parseAttendanceLimit(input.limit);
  const supabase = createSupabaseAdminClient();
  const startedAt = new Date().toISOString();
  await recordWorkerState(supabase, {
    last_worker_started_at: startedAt,
    last_worker_error: null,
  });
  try {
    const [{ data: messages, error: messagesError }, { data: roster, error: rosterError }] = await Promise.all([
      supabase.rpc("claim_pending_attendance_jobs", { p_limit: limit }),
      supabase.from("student_roster").select("student_number,student_name,grade,campus"),
    ]);
    if (messagesError) throw messagesError;
    if (rosterError) throw rosterError;

    const targets = (messages ?? []) as AttendanceLineMessage[];
    let candidates = 0;
    let ignored = 0;
    let retrying = 0;
    let dead = 0;
    for (let index = 0; index < targets.length; index += ATTENDANCE_AI_CONCURRENCY) {
      const batch = targets.slice(index, index + ATTENDANCE_AI_CONCURRENCY);
      const results = await Promise.all(batch.map((message) => processAttendanceMessage({
        supabase,
        message,
        roster: (roster ?? []) as RosterRow[],
      })));
      for (const result of results) {
        if (result === "candidate") candidates += 1;
        if (result === "ignored") ignored += 1;
        if (result === "retrying") retrying += 1;
        if (result === "dead") dead += 1;
      }
    }
    await recordWorkerState(supabase, {
      last_worker_succeeded_at: new Date().toISOString(),
      last_worker_error: null,
    });
    return { ok: true, processed: targets.length, candidates, ignored, retrying, dead, failed: retrying + dead };
  } catch (cause) {
    await recordWorkerState(supabase, { last_worker_error: errorMessage(cause) }).catch((runtimeError) => {
      console.error("Failed to record attendance worker error", runtimeError);
    });
    throw cause;
  }
}
