import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const validEventTypes = new Set<AttendanceEventType>(["absence", "late", "reschedule_request", "other"]);

function normalize(value: string) {
  return value.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

function isIsoDate(value: string | null | undefined): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");
}

function eventType(value: string | null | undefined): AttendanceEventType {
  return validEventTypes.has(value as AttendanceEventType) ? value as AttendanceEventType : "other";
}

function fallbackReason(value: AttendanceEventType) {
  if (value === "late") return "遅刻連絡";
  if (value === "reschedule_request") return "振替希望";
  if (value === "other") return "連絡";
  return "欠席連絡";
}

function expandDates(start: string | null | undefined, end: string | null | undefined) {
  if (!isIsoDate(start)) return [];
  if (!isIsoDate(end) || end < start) return [start];
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00+09:00`);
  const last = new Date(`${end}T00:00:00+09:00`);
  while (current <= last && dates.length < 31) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function normalizeItems(ai: AiAttendance) {
  const rawItems = Array.isArray(ai.items) && ai.items.length > 0 ? ai.items : [{
    event_type: ai.event_type,
    event_date: ai.event_date,
    date_start: ai.date_start,
    date_end: ai.date_end,
    subject: ai.subject,
    class_name: ai.class_name,
    summary: ai.summary,
    reason: ai.reason,
  }];
  const rows: Array<{
    event_type: AttendanceEventType;
    event_date: string | null;
    suggested_subject: string | null;
    suggested_class_name: string | null;
    ai_summary: string;
  }> = [];
  for (const item of rawItems) {
    const type = eventType(item.event_type ?? ai.event_type);
    const dates = expandDates(item.date_start ?? item.event_date ?? ai.date_start ?? ai.event_date, item.date_end ?? ai.date_end);
    const targetDates = dates.length > 0 ? dates : [null];
    for (const date of targetDates) {
      rows.push({
        event_type: type,
        event_date: date,
        suggested_subject: item.subject ?? ai.subject ?? null,
        suggested_class_name: item.class_name ?? ai.class_name ?? null,
        ai_summary: item.summary ?? ai.summary ?? item.reason ?? ai.reason ?? fallbackReason(type),
      });
    }
  }
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [row.event_type, row.event_date ?? "", normalize(row.suggested_subject ?? ""), normalize(row.suggested_class_name ?? ""), normalize(row.ai_summary)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 30);
  const supabase = createSupabaseAdminClient();
  const [{ data: reviewed }, { data: roster, error: rosterError }] = await Promise.all([
    supabase.from("attendance_message_reviews").select("message_id,result"),
    supabase.from("student_roster").select("student_number,student_name,grade,campus"),
  ]);
  if (rosterError) return NextResponse.json({ error: rosterError.message }, { status: 500 });
  const reviewedIds = new Set((reviewed ?? []).filter((row) => row.result !== "failed").map((row) => row.message_id as string));
  const since = new Date(Date.now() - 45 * 86400000).toISOString();
  const { data: messages, error } = await supabase
    .from("line_messages")
    .select("id,text,display_name,received_at,created_at")
    .eq("direction", "inbound")
    .eq("message_type", "text")
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const targets = (messages ?? []).filter((row) => !reviewedIds.has(row.id as string)).slice(0, limit);
  let candidates = 0;
  let ignored = 0;
  let failed = 0;
  for (const message of targets) {
    try {
      const ai = await extractWithAi({
        text: String(message.text ?? ""),
        receivedAt: String(message.received_at ?? message.created_at),
        displayName: typeof message.display_name === "string" ? message.display_name : null,
      });
      if (!ai.is_attendance) {
        await supabase.from("attendance_message_reviews").upsert({ message_id: message.id, result: "ignored" });
        ignored += 1;
        continue;
      }
      const items = normalizeItems(ai);
      const firstItem = items[0];
      const student = ai.student_name
        ? (roster ?? []).find((row) => normalize(String(row.student_name)) === normalize(ai.student_name!))
        : null;
      const confidence = Math.max(0, Math.min(1, Number(ai.confidence) || 0));
      const { data: candidate, error: insertError } = await supabase.from("attendance_candidates").insert({
        source_message_id: message.id,
        student_number: student?.student_number ?? null,
        suggested_student_name: ai.student_name ?? null,
        event_type: firstItem?.event_type ?? eventType(ai.event_type),
        event_date: firstItem?.event_date ?? null,
        suggested_subject: firstItem?.suggested_subject ?? ai.subject ?? null,
        suggested_class_name: firstItem?.suggested_class_name ?? ai.class_name ?? null,
        ai_summary: firstItem?.ai_summary ?? ai.summary ?? null,
        ai_confidence: confidence,
        ai_reason: ai.reason ?? null,
        raw_ai_result: ai,
      }).select("id").single();
      if (insertError) throw insertError;
      if (items.length > 0) {
        const { error: itemError } = await supabase.from("attendance_candidate_items").insert(items.map((item) => ({
          candidate_id: candidate.id,
          event_type: item.event_type,
          event_date: item.event_date,
          suggested_subject: item.suggested_subject,
          suggested_class_name: item.suggested_class_name,
          ai_summary: item.ai_summary,
        })));
        if (itemError) throw itemError;
      }
      await supabase.from("attendance_message_reviews").upsert({ message_id: message.id, result: "candidate" });
      candidates += 1;
    } catch (cause) {
      await supabase.from("attendance_message_reviews").upsert({
        message_id: message.id,
        result: "failed",
        error_message: cause instanceof Error ? cause.message.slice(0, 500) : String(cause).slice(0, 500),
      });
      failed += 1;
    }
  }
  return NextResponse.json({ ok: true, processed: targets.length, candidates, ignored, failed });
}
