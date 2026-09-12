import "server-only";

import { notionRequest } from "@/lib/notion";
import { canonicalTeacherName } from "@/lib/teacher-names";
import type { InterviewSurveyTeacherGroup } from "@/lib/interview-surveys";

type Property = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  rollup?: { type?: string; array?: Array<{ select?: { name?: string } | null }> };
  select?: { name?: string } | null;
};
type Page = { id: string; url?: string; created_time?: string; properties?: Record<string, Property> };
type QueryResult = { results?: Page[]; has_more?: boolean; next_cursor?: string | null };

const STUDENT_DATA_SOURCE_ID = "19ef0120-80a7-80b7-9f23-000b21e0a53b";
const SURVEY_STARTED_ON = "2026-09-09";
const SOURCES = [
  ["小4", "8aff0120-80a7-823e-9537-87dd8f5e84a0"], ["小5", "50df0120-80a7-8258-8d7a-879abd64b6fe"],
  ["小6", "97bf0120-80a7-821a-b0ba-87572758dce2"], ["中1", "978f0120-80a7-827e-90c4-87afdf38d445"],
  ["中2", "da2f0120-80a7-828d-b3a4-07429d0bcf00"], ["中3", "30af0120-80a7-838b-b0eb-07a763ae6856"],
] as const;
const TEACHER_ORDER = ["工藤", "金子", "鈴木", "金城", "髙山"];
function propertyText(property?: Property) {
  if (property?.type === "title") return (property.title ?? []).map(item => item.plain_text ?? "").join("").trim();
  if (property?.type === "rich_text") return (property.rich_text ?? []).map(item => item.plain_text ?? "").join("").trim();
  return "";
}

function propertyTeacher(property?: Property) {
  const raw = property?.type === "rollup" && property.rollup?.type === "array"
    ? (property.rollup.array ?? []).map(item => item.select?.name?.trim() ?? "").find(Boolean)
    : property?.type === "select" ? property.select?.name?.trim() : "";
  return raw ? canonicalTeacherName(raw) : "";
}

async function queryAll(dataSourceId: string, filter: Record<string, unknown>) {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const result = await notionRequest(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, filter, ...(cursor ? { start_cursor: cursor } : {}) }),
    }) as QueryResult;
    pages.push(...(result.results ?? []));
    cursor = result.has_more ? result.next_cursor ?? null : null;
  } while (cursor);
  return pages;
}

async function lookupTeacher(studentNumber: string, studentName: string) {
  const number = Number(studentNumber);
  if (Number.isSafeInteger(number)) {
    const pages = await queryAll(STUDENT_DATA_SOURCE_ID, { property: "学籍番号", number: { equals: number } });
    const teacher = propertyTeacher(pages[0]?.properties?.["担任"]);
    if (teacher) return teacher;
  }
  const pages = await queryAll(STUDENT_DATA_SOURCE_ID, { property: "生徒氏名", title: { equals: studentName } });
  return propertyTeacher(pages[0]?.properties?.["担任"]);
}

export async function loadInterviewSurveyGroups(): Promise<InterviewSurveyTeacherGroup[]> {
  const results = await Promise.all(SOURCES.map(async ([grade, id]) => ({
    grade,
    pages: await queryAll(id, { timestamp: "created_time", created_time: { on_or_after: SURVEY_STARTED_ON } }),
  })));
  const rows = await Promise.all(results.flatMap(({ grade, pages }) => pages.map(async page => {
    const properties = page.properties ?? {};
    const name = propertyText(Object.values(properties).find(property => property.type === "title")) || "氏名未登録";
    const teacher = propertyTeacher(properties["担任"]) || await lookupTeacher(propertyText(properties["学籍番号"]), name);
    return {
      grade,
      name,
      teacher: teacher || "担任未特定",
      notionUrl: page.url ?? `https://app.notion.com/p/${page.id.replaceAll("-", "")}`,
      submittedAt: page.created_time ?? "",
    };
  })));
  const groups = new Map<string, InterviewSurveyTeacherGroup["students"]>();
  for (const row of rows) groups.set(row.teacher, [...(groups.get(row.teacher) ?? []), {
    grade: row.grade,
    name: row.name,
    notionUrl: row.notionUrl,
    submittedAt: row.submittedAt,
  }]);
  return [...groups.entries()].sort(([left], [right]) => {
    const leftOrder = TEACHER_ORDER.indexOf(left);
    const rightOrder = TEACHER_ORDER.indexOf(right);
    return (leftOrder < 0 ? 999 : leftOrder) - (rightOrder < 0 ? 999 : rightOrder) || left.localeCompare(right, "ja");
  }).map(([teacher, students]) => ({
    teacher,
    students: students.sort((left, right) => left.submittedAt.localeCompare(right.submittedAt) || left.name.localeCompare(right.name, "ja")),
  }));
}
