import { NextResponse } from "next/server";
import { notionAttendanceDataSourceId, notionRequest } from "@/lib/notion";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

const eventLabels: Record<string, string> = {
  absence: "欠席",
  late: "遅刻",
  reschedule_request: "振替希望",
  other: "その他",
};

const title = (value: string) => ({ title: [{ type: "text", text: { content: value.slice(0, 200) } }] });
const richText = (value: string | null | undefined) => ({ rich_text: value ? [{ type: "text", text: { content: value.slice(0, 1900) } }] : [] });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const confirmedBy = typeof body.confirmed_by === "string" ? body.confirmed_by.trim() : "";
  if (!confirmedBy) return NextResponse.json({ error: "確認者名を入力してください" }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  const { data: candidate, error } = await supabase
    .from("attendance_candidates")
    .select("*,student_roster(student_name,grade,campus),lessons(label,start_time,campus),line_messages(text,received_at)")
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
    const message = Array.isArray(candidate.line_messages) ? candidate.line_messages[0] : candidate.line_messages;
    const studentName = student?.student_name ?? candidate.suggested_student_name ?? candidate.student_number;
    const eventLabel = eventLabels[candidate.event_type] ?? "その他";
    const existing = await notionRequest(`/data_sources/${notionAttendanceDataSourceId()}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 1, filter: { property: "アプリ記録ID", rich_text: { equals: id } } }),
    });
    const notionPage = existing.results?.[0] ?? await notionRequest("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: notionAttendanceDataSourceId() },
        properties: {
          "連絡名": title(`${studentName} ${candidate.event_date} ${eventLabel}`),
          "生徒情報DB": { relation: [{ id: profile.notion_page_id }] },
          "学籍番号": richText(candidate.student_number),
          "種別": { select: { name: eventLabel } },
          "対象日": { date: { start: candidate.event_date } },
          "授業・クラス": richText(lesson?.label ?? candidate.suggested_class_name),
          "科目": richText(candidate.suggested_subject),
          "校舎": { select: student?.campus ? { name: student.campus } : null },
          "LINE原文": richText(message?.text),
          "LINE受信日時": { date: message?.received_at ? { start: message.received_at } : null },
          "確認者": richText(confirmedBy),
          "確認日時": { date: { start: claimedAt } },
          "状態": { select: { name: "確認済み" } },
          "アプリ記録ID": richText(id),
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
