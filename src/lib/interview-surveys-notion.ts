import "server-only";

import { notionRequest } from "@/lib/notion";
import { canonicalTeacherName } from "@/lib/teacher-names";
import { matchSurveyStudent,normalizeSurveyName } from "@/lib/survey-student-match.mjs";
import type { InterviewSurveyTeacherGroup } from "@/lib/interview-surveys";

type Property = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  rollup?: { type?: string; array?: Array<{ select?: { name?: string } | null }> };
  select?: { name?: string } | null;
  number?: number | null;
  formula?: { string?: string | null };
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
  if (property?.type === "number") return property.number == null ? "" : String(property.number);
  if (property?.type === "formula") return property.formula?.string ?? "";
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
  const seen=new Set<string>();
  do {
    const result = await notionRequest(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, filter, ...(cursor ? { start_cursor: cursor } : {}) }),
    }) as QueryResult;
    if(!Array.isArray(result.results))throw Error('アンケートの取得結果を確認できません。');
    pages.push(...result.results);
    if(result.has_more&&(!result.next_cursor||seen.has(result.next_cursor)||seen.size>=100))throw Error('アンケートを最後まで取得できません。');
    cursor = result.has_more ? result.next_cursor ?? null : null;
    if(cursor)seen.add(cursor);
  } while (cursor);
  return pages;
}

/** Uses the same active campaign as the existing interview survey screen. No write-back or guessed identities. */
export async function loadInvitationSurveyResponses(students:Record<string,unknown>[]){
 const roster=students.filter(s=>s.enrollment_status==='current_roster').map(s=>({name:String(s.student_name??''),number:String(s.student_number??''),grade:String(s.grade??''),teacher:String(s.homeroom_teacher??'')}));
 const results=await Promise.all(SOURCES.map(async([grade,id])=>({grade,pages:await queryAll(id,{timestamp:'created_time',created_time:{on_or_after:SURVEY_STARTED_ON}})})));
 const synced_at=new Date().toISOString(),base={source_name:'面談アンケート',school_year:SURVEY_STARTED_ON.slice(0,4)+'年度',round_label:SURVEY_STARTED_ON+'開始分',subject:'',synced_at,eligible_grades:SOURCES.map(([grade])=>grade)};
 const rows:Record<string,unknown>[]=[{...base,student_number:null,link_status:'campaign',answered_at:null}];let unmatched=0;
 for(const {grade,pages} of results)for(const page of pages){
  const p=page.properties??{},name=propertyText(Object.values(p).find(v=>v.type==='title')),number=propertyText(p['学籍番号']);
  const match=matchSurveyStudent({name,number,grade},roster),answered_at=page.created_time?new Date(page.created_time).toLocaleString('sv-SE',{timeZone:'Asia/Tokyo'}):null;
  if(match)rows.push({...base,student_number:match.number,link_status:'linked',answered_at});
  else {unmatched++;for(const candidate of roster.filter(s=>s.number===number||normalizeSurveyName(s.name)===normalizeSurveyName(name)))rows.push({...base,student_number:candidate.number,link_status:'needs_review',answered_at});}
 }
 return {rows,unmatched};
}

export async function loadInterviewSurveyGroups(): Promise<InterviewSurveyTeacherGroup[]> {
  const results = await Promise.all(SOURCES.map(async ([grade, id]) => ({
    grade,
    pages: await queryAll(id, { timestamp: "created_time", created_time: { on_or_after: SURVEY_STARTED_ON } }),
  })));
  // One roster fetch replaces per-answer requests, including whitespace variants.
  const needsRoster = results.some(({pages})=>pages.some(page=>!propertyTeacher(page.properties?.["担任"])));
  const roster = needsRoster ? (await queryAll(STUDENT_DATA_SOURCE_ID, {property:"状態",select:{equals:"在塾"}})).map(page=>({
    name:propertyText(page.properties?.["生徒氏名"]),number:propertyText(page.properties?.["学籍番号"]),
    grade:propertyText(page.properties?.["学年"]),teacher:propertyTeacher(page.properties?.["担任"]),
  })) : [];
  const rows = results.flatMap(({ grade, pages }) => pages.map(page => {
    const properties = page.properties ?? {};
    const name = propertyText(Object.values(properties).find(property => property.type === "title")) || "氏名未登録";
    const teacher = propertyTeacher(properties["担任"]) || matchSurveyStudent({number:propertyText(properties["学籍番号"]),name,grade},roster)?.teacher;
    return {
      grade,
      name,
      teacher: teacher || "担任未特定",
      notionUrl: page.url ?? `https://app.notion.com/p/${page.id.replaceAll("-", "")}`,
      submittedAt: page.created_time ?? "",
    };
  }));
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
