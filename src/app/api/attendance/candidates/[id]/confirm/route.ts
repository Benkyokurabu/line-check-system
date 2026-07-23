import { NextResponse } from "next/server";
import { notionAbsenceDataSourceId, notionRequest } from "@/lib/notion";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

const title = (value: string) => ({ title: [{ type: "text", text: { content: value.slice(0, 200) } }] });
const richText = (value: string | null | undefined) => ({ rich_text: value ? [{ type: "text", text: { content: value.slice(0, 1900) } }] : [] });

const fullWidth = (value: string) => value.normalize("NFKC").replace(/[0-9A-Z]/g, (char) =>
  String.fromCharCode(char.charCodeAt(0) + 0xfee0),
);

function notionLessonName(lesson: { label?: string | null; source_payload?: Record<string, unknown> | null } | null) {
  const payload = lesson?.source_payload ?? {};
  const gradeMap: Record<string, string> = { j1: "1", j2: "2", j3: "3", e4: "4", e5: "5", e6: "6" };
  const subjectMap: Record<string, string> = { eng: "英", math: "数", arith: "算", jp: "国", sci: "理", soc: "社" };
  const grade = gradeMap[String(payload.grade ?? "")] ?? "";
  const className = String(payload.class ?? "").trim();
  const subject = subjectMap[String(payload.subject ?? "")] ?? "";
  if (grade && className && subject) return fullWidth(`${grade}${className}${subject}`);
  return lesson?.label?.trim() || null;
}

function campusFromRegisteredName(value: string | null | undefined) {
  const normalized = (value ?? "").normalize("NFKC").replace(/[ \t\r\n\u3000]/g, "");
  if (!normalized) return null;
  if (normalized.includes("南教室") || normalized.includes("南校") || normalized.includes("南")) return "南教室";
  if (normalized.includes("本校")) return "本校";
  return null;
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const confirmedBy = typeof body.confirmed_by === "string" ? body.confirmed_by.trim() : "";
  if (!confirmedBy) return NextResponse.json({ error: "確認者名を入力してください" }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  const { data: candidate, error } = await supabase
    .from("attendance_candidates")
    .select("*,student_roster(student_name,grade,campus),lessons(label,start_time,campus,source_payload),line_messages(line_user_id)")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!candidate) return NextResponse.json({ error: "候補が見つかりません" }, { status: 404 });
  if (candidate.status === "confirmed" && candidate.notion_page_id) {
    return NextResponse.json({ ok: true, notion_page_id: candidate.notion_page_id, already_registered: true });
  }
  if (!candidate.student_number || !candidate.event_date) {
    return NextResponse.json({ error: "生徒と対象日を確定してください" }, { status: 400 });
  }
  const { data: profile } = await supabase
    .from("notion_student_profiles")
    .select("notion_page_id")
    .eq("student_number", candidate.student_number)
    .limit(1)
    .maybeSingle();
  if (!profile?.notion_page_id) {
    return NextResponse.json({ error: "この生徒はNotion生徒情報DBと紐づいていません" }, { status: 400 });
  }
  const claimedAt = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("attendance_candidates")
    .update({ status: "registering", confirmed_by: confirmedBy, notion_error: null })
    .eq("id", id)
    .in("status", ["pending", "notion_failed"])
    .select("id")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ error: "別の登録処理が進行中です" }, { status: 409 });
  try {
    const student = Array.isArray(candidate.student_roster) ? candidate.student_roster[0] : candidate.student_roster;
    const lesson = Array.isArray(candidate.lessons) ? candidate.lessons[0] : candidate.lessons;
    const lineMessage = Array.isArray(candidate.line_messages) ? candidate.line_messages[0] : candidate.line_messages;
    const { data: senderAlias } = lineMessage?.line_user_id ? await supabase
      .from("line_user_aliases")
      .select("alias_name")
      .eq("line_user_id", lineMessage.line_user_id)
      .maybeSingle() : { data: null };
    const lessonName = notionLessonName(lesson);
    const campus = campusFromRegisteredName(senderAlias?.alias_name) ?? lesson?.campus ?? student?.campus ?? null;
    const dataSourceId = notionAbsenceDataSourceId();
    const filters: unknown[] = [
      { property: "名前", relation: { contains: profile.notion_page_id } },
      { property: "日付", date: { equals: candidate.event_date } },
    ];
    if (lessonName) filters.push({ property: "授業", select: { equals: lessonName } });
    const existing = await notionRequest(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 1, filter: { and: filters } }),
    });
    const notionPage = existing.results?.[0] ?? await notionRequest("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties: {
          "理由": title(candidate.ai_summary?.trim() || "欠席連絡"),
          "名前": { relation: [{ id: profile.notion_page_id }] },
          "日付": { date: { start: candidate.event_date } },
          "授業": { select: lessonName ? { name: lessonName } : null },
          "授業校舎": { select: campus ? { name: campus } : null },
          "備考": richText(null),
          "連続": richText(null),
        },
      }),
    });
    const { error: saveError } = await supabase.from("attendance_candidates").update({
      status: "confirmed",
      confirmed_at: claimedAt,
      notion_page_id: notionPage.id,
      notion_error: null,
    }).eq("id", id);
    if (saveError) throw new Error(`Notion登録後の履歴保存に失敗しました: ${saveError.message}`);
    return NextResponse.json({ ok: true, notion_page_id: notionPage.id });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await supabase.from("attendance_candidates").update({ status: "notion_failed", notion_error: message.slice(0, 500) }).eq("id", id);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
