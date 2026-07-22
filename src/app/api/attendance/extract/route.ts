import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AiAttendance = {
  is_attendance: boolean;
  student_name?: string;
  event_type?: "absence" | "late" | "reschedule_request" | "other";
  event_date?: string;
  subject?: string;
  class_name?: string;
  summary?: string;
  confidence?: number;
  reason?: string;
};

function normalize(value: string) {
  return value.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

async function extractWithAi(input: { text: string; receivedAt: string }) {
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
          content: "日本の学習塾へのLINEから欠席・遅刻・振替希望を抽出する。推測を確定扱いせずJSONのみ返す。今日・明日はreceived_atの日本時間を基準にYYYY-MM-DDへ直す。本文に生徒名がなければstudent_nameは空にする。",
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: "{is_attendance,student_name,event_type,event_date,subject,class_name,summary,confidence,reason}を返す。対象外はis_attendance=false。event_typeはabsence/late/reschedule_request/other。生徒や日付が不明でも欠席系ならtrueにする。",
            received_at: input.receivedAt,
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
    .select("id,text,received_at,created_at")
    .eq("direction", "inbound")
    .eq("message_type", "text")
    .gte("received_at", since)
    .order("received_at", { ascending: true })
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
      });
      if (!ai.is_attendance) {
        await supabase.from("attendance_message_reviews").upsert({ message_id: message.id, result: "ignored" });
        ignored += 1;
        continue;
      }
      const student = ai.student_name
        ? (roster ?? []).find((row) => normalize(String(row.student_name)) === normalize(ai.student_name!))
        : null;
      const confidence = Math.max(0, Math.min(1, Number(ai.confidence) || 0));
      const { error: insertError } = await supabase.from("attendance_candidates").insert({
        source_message_id: message.id,
        student_number: student?.student_number ?? null,
        suggested_student_name: ai.student_name ?? null,
        event_type: ["absence", "late", "reschedule_request", "other"].includes(ai.event_type ?? "") ? ai.event_type : "other",
        event_date: /^\d{4}-\d{2}-\d{2}$/.test(ai.event_date ?? "") ? ai.event_date : null,
        suggested_subject: ai.subject ?? null,
        suggested_class_name: ai.class_name ?? null,
        ai_summary: ai.summary ?? null,
        ai_confidence: confidence,
        ai_reason: ai.reason ?? null,
        raw_ai_result: ai,
      });
      if (insertError) throw insertError;
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
