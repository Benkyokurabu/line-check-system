import { NextResponse } from "next/server";
import { notionAbsenceDataSourceId, notionRequest } from "@/lib/notion";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

type NotionProperty = { type?: string };
type NotionDataSource = { properties?: Record<string, NotionProperty> };
type ResolvedProperty = { name: string; type: string };

const title = (value: string) => ({ title: [{ type: "text", text: { content: value.slice(0, 200) } }] });
const richText = (value: string | null | undefined) => ({ rich_text: value ? [{ type: "text", text: { content: value.slice(0, 1900) } }] : [] });

const fullWidth = (value: string) => value.normalize("NFKC").replace(/[0-9A-Z]/g, (char) =>
  String.fromCharCode(char.charCodeAt(0) + 0xfee0),
);

function envFirst(envName: string, fallback: string[]) {
  const value = process.env[envName]?.trim();
  return value ? [value, ...fallback.filter((item) => item !== value)] : fallback;
}

function propertyMap(source: unknown) {
  const properties = (source as NotionDataSource | null)?.properties;
  return properties && typeof properties === "object" ? properties : {};
}

function resolveProperty(properties: Record<string, NotionProperty>, names: string[], label: string): ResolvedProperty {
  for (const name of names) {
    const property = properties[name];
    if (property?.type) return { name, type: property.type };
  }
  throw new Error(`Notion欠席DBに${label}列が見つかりません（候補: ${names.join(" / ")}）`);
}

function optionalProperty(properties: Record<string, NotionProperty>, names: string[]): ResolvedProperty | null {
  for (const name of names) {
    const property = properties[name];
    if (property?.type) return { name, type: property.type };
  }
  return null;
}

function textProperty(property: ResolvedProperty, value: string | null | undefined) {
  if (property.type === "title") return title(value?.trim() || "欠席連絡");
  if (property.type === "rich_text") return richText(value?.trim() || null);
  if (property.type === "select") return { select: value?.trim() ? { name: value.trim() } : null };
  throw new Error(`Notionの${property.name}列はテキスト/セレクト型ではありません`);
}

function dateFilter(property: ResolvedProperty, value: string) {
  return { property: property.name, date: { equals: value } };
}

function lessonFilter(property: ResolvedProperty, value: string) {
  if (property.type === "select") return { property: property.name, select: { equals: value } };
  if (property.type === "rich_text" || property.type === "title") return { property: property.name, rich_text: { contains: value } };
  return null;
}

function lessonProperty(property: ResolvedProperty, value: string | null) {
  if (property.type === "select") return { select: value ? { name: value } : null };
  if (property.type === "rich_text") return richText(value);
  if (property.type === "title") return title(value || "欠席連絡");
  throw new Error(`Notionの${property.name}列は授業名を書ける型ではありません`);
}

function campusProperty(property: ResolvedProperty, value: string | null) {
  if (property.type === "select") return { select: value ? { name: value } : null };
  if (property.type === "rich_text") return richText(value);
  throw new Error(`Notionの${property.name}列は校舎を書ける型ではありません`);
}

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
  const normalized = (value ?? "").normalize("NFKC");
  const prefix = normalized.match(/^([本南])\s/);
  if (prefix?.[1] === "本") return "本校";
  if (prefix?.[1] === "南") return "南教室";
  return null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const confirmedBy = typeof body.confirmed_by === "string" ? body.confirmed_by.trim() : "";
  const campusOverride = typeof body.campus === "string" && ["本校", "南教室"].includes(body.campus) ? body.campus : null;
  if (!confirmedBy) return NextResponse.json({ error: "確認者名を入力してください" }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  const { data: candidate, error } = await supabase
    .from("attendance_candidates")
    .select("*,student_roster(student_name,grade,campus,homeroom_teacher),lessons(label,start_time,campus,source_payload),line_messages(line_user_id)")
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
    const campus = campusOverride ?? campusFromRegisteredName(senderAlias?.alias_name) ?? lesson?.campus ?? student?.campus ?? null;
    const dataSourceId = notionAbsenceDataSourceId();
    const dataSource = await notionRequest(`/data_sources/${dataSourceId}`);
    const properties = propertyMap(dataSource);
    const studentProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_STUDENT_PROPERTY", ["生徒情報DB", "名前"]), "生徒");
    const dateProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_DATE_PROPERTY", ["日付", "対象日"]), "日付");
    const reasonProperty = resolveProperty(properties, envFirst("NOTION_ATTENDANCE_REASON_PROPERTY", ["理由", "連絡名"]), "理由");
    const lessonNameProperty = optionalProperty(properties, envFirst("NOTION_ATTENDANCE_LESSON_PROPERTY", ["授業", "授業・クラス"]));
    const campusNameProperty = optionalProperty(properties, envFirst("NOTION_ATTENDANCE_CAMPUS_PROPERTY", ["授業校舎", "校舎"]));
    const teacherProperty = optionalProperty(properties, envFirst("NOTION_ATTENDANCE_TEACHER_PROPERTY", ["担任"]));
    const filters: unknown[] = [
      { property: studentProperty.name, relation: { contains: profile.notion_page_id } },
      dateFilter(dateProperty, candidate.event_date),
    ];
    const lessonFilterValue = lessonName && lessonNameProperty ? lessonFilter(lessonNameProperty, lessonName) : null;
    if (lessonFilterValue) filters.push(lessonFilterValue);
    const existing = await notionRequest(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 1, filter: { and: filters } }),
    });
    const pageProperties: Record<string, unknown> = {
      [reasonProperty.name]: textProperty(reasonProperty, candidate.ai_summary?.trim() || "欠席連絡"),
      [studentProperty.name]: { relation: [{ id: profile.notion_page_id }] },
      [dateProperty.name]: { date: { start: candidate.event_date } },
    };
    if (lessonNameProperty) pageProperties[lessonNameProperty.name] = lessonProperty(lessonNameProperty, lessonName);
    if (campusNameProperty) pageProperties[campusNameProperty.name] = campusProperty(campusNameProperty, campus);
    if (teacherProperty) pageProperties[teacherProperty.name] = textProperty(teacherProperty, student?.homeroom_teacher ?? null);
    const notionPage = existing.results?.[0] ?? await notionRequest("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties: pageProperties,
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
