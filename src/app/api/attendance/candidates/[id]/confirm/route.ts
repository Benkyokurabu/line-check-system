import { NextResponse } from "next/server";
import { notionAbsenceDataSourceId, notionRequest } from "@/lib/notion";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

type NotionProperty = { type?: string };
type NotionDataSource = { properties?: Record<string, NotionProperty> };
type ResolvedProperty = { name: string; type: string };
type LessonRow = { label?: string | null; start_time?: string | null; campus?: string | null; source_payload?: Record<string, unknown> | null } | null;
type CandidateItem = {
  id: string;
  event_type: string | null;
  event_date: string | null;
  lesson_id: string | null;
  suggested_subject: string | null;
  suggested_class_name: string | null;
  ai_summary: string | null;
  status: string | null;
  notion_page_id: string | null;
  lessons?: LessonRow | LessonRow[];
};

const title = (value: string) => ({ title: [{ type: "text", text: { content: value.slice(0, 200) } }] });
const richText = (value: string | null | undefined) => ({ rich_text: value ? [{ type: "text", text: { content: value.slice(0, 1900) } }] : [] });

const fullWidth = (value: string) => value.normalize("NFKC").replace(/[0-9A-Z]/g, (char) =>
  String.fromCharCode(char.charCodeAt(0) + 0xfee0),
);

function envFirst(envName: string, fallback: string[]) {
  const value = process.env[envName]?.trim();
  return value ? [value, ...fallback.filter((item) => item !== value)] : fallback;
}

function eventTypeLabel(value: string | null | undefined) {
  if (value === "late") return "遅刻";
  if (value === "reschedule_request") return "振替希望";
  if (value === "other") return "その他";
  return "欠席";
}

function fallbackReason(value: string | null | undefined) {
  if (value === "late") return "遅刻連絡";
  if (value === "reschedule_request") return "振替希望";
  if (value === "other") return "連絡";
  return "欠席連絡";
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

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function notionLessonName(lesson: LessonRow) {
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

function fallbackItems(candidate: Record<string, unknown>): CandidateItem[] {
  const items = candidate.attendance_candidate_items as CandidateItem[] | null | undefined;
  const activeItems = (items ?? []).filter((item) => item.status !== "dismissed");
  if (activeItems.length > 0) return activeItems;
  return [{
    id: "legacy",
    event_type: candidate.event_type as string | null,
    event_date: candidate.event_date as string | null,
    lesson_id: candidate.lesson_id as string | null,
    suggested_subject: candidate.suggested_subject as string | null,
    suggested_class_name: candidate.suggested_class_name as string | null,
    ai_summary: candidate.ai_summary as string | null,
    status: candidate.status as string | null,
    notion_page_id: candidate.notion_page_id as string | null,
    lessons: candidate.lessons as LessonRow | LessonRow[] | undefined,
  }];
}

async function registerItem(input: {
  dataSourceId: string;
  item: CandidateItem;
  profilePageId: string;
  campus: string | null;
  studentCampus: string | null;
  properties: Record<string, NotionProperty>;
}) {
  if (!input.item.event_date) throw new Error("対象日を入力してください");
  const lesson = firstRelation(input.item.lessons);
  const lessonName = notionLessonName(lesson);
  if (!lessonName) throw new Error("授業を選択してください");
  const campus = input.campus ?? lesson?.campus ?? input.studentCampus ?? null;
  const studentProperty = resolveProperty(input.properties, envFirst("NOTION_ATTENDANCE_STUDENT_PROPERTY", ["生徒情報DB", "名前"]), "生徒");
  const dateProperty = resolveProperty(input.properties, envFirst("NOTION_ATTENDANCE_DATE_PROPERTY", ["日付", "対象日"]), "日付");
  const reasonProperty = resolveProperty(input.properties, envFirst("NOTION_ATTENDANCE_REASON_PROPERTY", ["理由", "連絡名"]), "理由");
  const lessonNameProperty = optionalProperty(input.properties, envFirst("NOTION_ATTENDANCE_LESSON_PROPERTY", ["授業", "授業・クラス"]));
  const campusNameProperty = optionalProperty(input.properties, envFirst("NOTION_ATTENDANCE_CAMPUS_PROPERTY", ["授業校舎", "校舎"]));
  const typeProperty = optionalProperty(input.properties, envFirst("NOTION_ATTENDANCE_TYPE_PROPERTY", ["種別", "区分"]));
  const filters: unknown[] = [
    { property: studentProperty.name, relation: { contains: input.profilePageId } },
    dateFilter(dateProperty, input.item.event_date),
  ];
  const lessonFilterValue = lessonNameProperty ? lessonFilter(lessonNameProperty, lessonName) : null;
  if (lessonFilterValue) filters.push(lessonFilterValue);
  const existing = await notionRequest(`/data_sources/${input.dataSourceId}/query`, {
    method: "POST",
    body: JSON.stringify({ page_size: 1, filter: { and: filters } }),
  });
  const pageProperties: Record<string, unknown> = {
    [reasonProperty.name]: textProperty(reasonProperty, input.item.ai_summary?.trim() || fallbackReason(input.item.event_type)),
    [studentProperty.name]: { relation: [{ id: input.profilePageId }] },
    [dateProperty.name]: { date: { start: input.item.event_date } },
  };
  if (lessonNameProperty) pageProperties[lessonNameProperty.name] = lessonProperty(lessonNameProperty, lessonName);
  if (campusNameProperty) pageProperties[campusNameProperty.name] = campusProperty(campusNameProperty, campus);
  if (typeProperty) pageProperties[typeProperty.name] = textProperty(typeProperty, eventTypeLabel(input.item.event_type));
  const notionPage = existing.results?.[0] ?? await notionRequest("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: input.dataSourceId },
      properties: pageProperties,
    }),
  });
  return notionPage.id as string;
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
    .select("*,student_roster(student_name,grade,campus,homeroom_teacher),lessons(label,start_time,campus,source_payload),attendance_candidate_items(*,lessons(label,start_time,campus,source_payload)),line_messages(line_user_id)")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!candidate) return NextResponse.json({ error: "候補が見つかりません" }, { status: 404 });
  if (!candidate.student_number) return NextResponse.json({ error: "生徒を確定してください" }, { status: 400 });

  const items = fallbackItems(candidate).filter((item) => item.status !== "confirmed");
  if (items.length === 0 && candidate.status === "confirmed") {
    return NextResponse.json({ ok: true, already_registered: true });
  }
  if (items.length === 0) return NextResponse.json({ error: "登録する行がありません" }, { status: 400 });

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
    const student = firstRelation(candidate.student_roster) as { campus?: string | null } | null;
    const lineMessage = firstRelation(candidate.line_messages) as { line_user_id?: string | null } | null;
    const { data: senderAlias } = lineMessage?.line_user_id ? await supabase
      .from("line_user_aliases")
      .select("alias_name")
      .eq("line_user_id", lineMessage.line_user_id)
      .maybeSingle() : { data: null };
    const campus = campusOverride ?? campusFromRegisteredName(senderAlias?.alias_name) ?? null;
    const dataSourceId = notionAbsenceDataSourceId();
    const dataSource = await notionRequest(`/data_sources/${dataSourceId}`);
    const properties = propertyMap(dataSource);
    const pageIds: string[] = [];

    for (const item of items) {
      const notionPageId = await registerItem({
        dataSourceId,
        item,
        profilePageId: profile.notion_page_id,
        campus,
        studentCampus: student?.campus ?? null,
        properties,
      });
      pageIds.push(notionPageId);
      if (item.id !== "legacy") {
        const { error: itemSaveError } = await supabase.from("attendance_candidate_items").update({
          status: "confirmed",
          notion_page_id: notionPageId,
          notion_error: null,
        }).eq("id", item.id);
        if (itemSaveError) throw new Error(`Notion登録後の行保存に失敗しました: ${itemSaveError.message}`);
      }
    }

    const { error: saveError } = await supabase.from("attendance_candidates").update({
      status: "confirmed",
      confirmed_at: claimedAt,
      notion_page_id: pageIds[0] ?? null,
      notion_error: null,
    }).eq("id", id);
    if (saveError) throw new Error(`Notion登録後の履歴保存に失敗しました: ${saveError.message}`);
    return NextResponse.json({ ok: true, notion_page_ids: pageIds, notion_page_id: pageIds[0] ?? null });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await supabase.from("attendance_candidates").update({ status: "notion_failed", notion_error: message.slice(0, 500) }).eq("id", id);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
