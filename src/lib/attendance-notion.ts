import { notionAbsenceDataSourceId, notionRequest } from "@/lib/notion";
import {
  attendanceReasonPropertyNames,
  attendanceTypePropertyNames,
} from "@/lib/classroom-attendance-display.mjs";

type NotionProperty = { type?: string };
type NotionDataSource = { properties?: Record<string, NotionProperty> };
type ResolvedProperty = { name: string; type: string };

export type AttendanceNotionEvent = {
  event_date: string;
  event_type: string;
  reason: string | null;
  student_number: string;
  lesson_id: string;
  lessons?: {
    label?: string | null;
    start_time?: string | null;
    campus?: string | null;
    source_payload?: Record<string, unknown> | null;
  } | null;
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
  if (property.type === "status") return { status: value?.trim() ? { name: value.trim() } : null };
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

function eventTypeLabel(value: string | null | undefined) {
  if (value === "late") return "遅刻";
  if (value === "early_leave") return "早退";
  return "欠席";
}

function fallbackReason(value: string | null | undefined) {
  if (value === "late") return "遅刻連絡";
  if (value === "early_leave") return "早退連絡";
  return "欠席連絡";
}

function notionLessonName(lesson: AttendanceNotionEvent["lessons"]) {
  const payload = lesson?.source_payload ?? {};
  const gradeMap: Record<string, string> = { j1: "1", j2: "2", j3: "3", e4: "4", e5: "5", e6: "6" };
  const subjectMap: Record<string, string> = { eng: "英", math: "数", arith: "算", jp: "国", sci: "理", soc: "社" };
  const grade = gradeMap[String(payload.grade ?? "")] ?? "";
  const className = String(payload.class ?? "").trim();
  const subject = subjectMap[String(payload.subject ?? "")] ?? "";
  if (grade && className && subject) return fullWidth(`${grade}${className}${subject}`);
  return lesson?.label?.trim() || null;
}

async function notionContext() {
  const dataSourceId = notionAbsenceDataSourceId();
  const dataSource = await notionRequest(`/data_sources/${dataSourceId}`);
  return { dataSourceId, properties: propertyMap(dataSource) };
}

function buildProperties(input: {
  event: AttendanceNotionEvent;
  profilePageId: string;
  properties: Record<string, NotionProperty>;
}) {
  const lessonName = notionLessonName(input.event.lessons);
  if (!lessonName) throw new Error("授業を選択してください");
  const studentProperty = resolveProperty(input.properties, envFirst("NOTION_ATTENDANCE_STUDENT_PROPERTY", ["生徒情報DB", "名前"]), "生徒");
  const dateProperty = resolveProperty(input.properties, envFirst("NOTION_ATTENDANCE_DATE_PROPERTY", ["日付", "対象日"]), "日付");
  const reasonProperty = resolveProperty(input.properties, attendanceReasonPropertyNames(process.env.NOTION_ATTENDANCE_REASON_PROPERTY), "理由");
  const lessonNameProperty = optionalProperty(input.properties, envFirst("NOTION_ATTENDANCE_LESSON_PROPERTY", ["授業", "授業・クラス"]));
  const campusNameProperty = optionalProperty(input.properties, envFirst("NOTION_ATTENDANCE_CAMPUS_PROPERTY", ["授業校舎", "校舎"]));
  const typeProperty = optionalProperty(input.properties, attendanceTypePropertyNames(process.env.NOTION_ATTENDANCE_TYPE_PROPERTY));
  const pageProperties: Record<string, unknown> = {
    [reasonProperty.name]: textProperty(reasonProperty, input.event.reason?.trim() || fallbackReason(input.event.event_type)),
    [studentProperty.name]: { relation: [{ id: input.profilePageId }] },
    [dateProperty.name]: { date: { start: input.event.event_date } },
  };
  if (lessonNameProperty) pageProperties[lessonNameProperty.name] = lessonProperty(lessonNameProperty, lessonName);
  if (campusNameProperty) pageProperties[campusNameProperty.name] = campusProperty(campusNameProperty, input.event.lessons?.campus ?? null);
  if (typeProperty) pageProperties[typeProperty.name] = textProperty(typeProperty, eventTypeLabel(input.event.event_type));
  return { pageProperties, studentProperty, dateProperty, lessonNameProperty, lessonName };
}

export async function upsertAttendanceNotionPage(input: {
  event: AttendanceNotionEvent;
  profilePageId: string;
  notionPageId?: string | null;
}) {
  const { dataSourceId, properties } = await notionContext();
  const { pageProperties, studentProperty, dateProperty, lessonNameProperty, lessonName } = buildProperties({
    event: input.event,
    profilePageId: input.profilePageId,
    properties,
  });
  if (input.notionPageId) {
    const page = await notionRequest(`/pages/${input.notionPageId}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: false, properties: pageProperties }),
    });
    return page.id as string;
  }
  const filters: unknown[] = [
    { property: studentProperty.name, relation: { contains: input.profilePageId } },
    dateFilter(dateProperty, input.event.event_date),
  ];
  const lessonFilterValue = lessonNameProperty ? lessonFilter(lessonNameProperty, lessonName) : null;
  if (lessonFilterValue) filters.push(lessonFilterValue);
  const existing = await notionRequest(`/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body: JSON.stringify({ page_size: 1, filter: { and: filters } }),
  });
  const existingPageId = (existing.results?.[0]?.id as string | undefined) ?? null;
  if (existingPageId) {
    const page = await notionRequest(`/pages/${existingPageId}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: false, properties: pageProperties }),
    });
    return page.id as string;
  }
  const page = await notionRequest("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties: pageProperties,
    }),
  });
  return page.id as string;
}

export async function archiveAttendanceNotionPage(notionPageId: string) {
  await notionRequest(`/pages/${notionPageId}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true }),
  });
}
