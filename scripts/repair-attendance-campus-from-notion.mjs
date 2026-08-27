import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { lessonNotionIdentity, normalizeCampus, resolveNotionLesson } from "../src/lib/attendance-campus-consistency.mjs";

function loadEnvFile(fileName) {
  const filePath = path.resolve(fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const sinceArg = process.argv.slice(2).find((arg) => arg.startsWith("--since="));
const since = sinceArg?.slice("--since=".length) || "2026-08-12";
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("--since=YYYY-MM-DD で指定してください");

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const notionToken = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Supabaseの管理接続情報がありません");
if (!notionToken) throw new Error("Notion APIトークンがありません");
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const notionVersion = process.env.NOTION_VERSION ?? "2025-09-03";

async function notionPage(id) {
  const response = await fetch(`https://api.notion.com/v1/pages/${id}`, {
    headers: { Authorization: `Bearer ${notionToken}`, "Notion-Version": notionVersion },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? `Notion API ${response.status}`);
  return body;
}

function notionText(property) {
  if (!property || typeof property !== "object") return null;
  if (property.type === "select") return property.select?.name ?? null;
  if (property.type === "status") return property.status?.name ?? null;
  if (property.type === "date") return property.date?.start ?? null;
  const items = property[property.type];
  if (Array.isArray(items)) return items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim() || null;
  return null;
}

function firstProperty(properties, names) {
  for (const name of names) {
    const value = notionText(properties?.[name]);
    if (value) return value;
  }
  return null;
}

function firstRelation(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function fetchAll(table, select, configure) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(select).range(from, from + 999);
    query = configure(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

const events = await fetchAll(
  "attendance_events",
  "*,student_roster(student_name,campus),lessons(id,lesson_date,campus,grade,class_name,subject,label,source_payload)",
  (query) => query.gte("event_date", since).eq("status", "confirmed").order("event_date"),
);
const lessons = await fetchAll(
  "lessons",
  "id,lesson_date,campus,grade,class_name,subject,label,source_payload",
  (query) => query.gte("lesson_date", since).order("lesson_date"),
);

const mismatches = events.filter((event) => {
  const roster = firstRelation(event.student_roster);
  const lesson = firstRelation(event.lessons);
  return normalizeCampus(roster?.campus) && normalizeCampus(lesson?.campus) &&
    normalizeCampus(roster.campus) !== normalizeCampus(lesson.campus) &&
    !(event.cross_campus_override === true && String(event.cross_campus_reason ?? "").trim());
});

const plans = [];
for (const event of mismatches) {
  const currentLesson = firstRelation(event.lessons);
  const roster = firstRelation(event.student_roster);
  if (!event.notion_page_id) {
    plans.push({ status: "unresolved", reason: "notion_page_idなし", event, currentLesson, roster });
    continue;
  }
  try {
    const page = await notionPage(event.notion_page_id);
    const notionDate = firstProperty(page.properties, [process.env.NOTION_ATTENDANCE_DATE_PROPERTY, "日付", "対象日"].filter(Boolean));
    const notionCampus = firstProperty(page.properties, [process.env.NOTION_ATTENDANCE_CAMPUS_PROPERTY, "授業校舎", "校舎"].filter(Boolean));
    const notionLesson = firstProperty(page.properties, [process.env.NOTION_ATTENDANCE_LESSON_PROPERTY, "授業", "授業・クラス"].filter(Boolean));
    if (!notionDate || !notionCampus || !notionLesson) {
      plans.push({ status: "unresolved", reason: "Notionの日付・授業校舎・授業が不足", event, currentLesson, roster, notion: { notionDate, notionCampus, notionLesson } });
      continue;
    }
    const resolved = resolveNotionLesson(lessons, { date: notionDate, campus: notionCampus, lessonName: notionLesson });
    if (!resolved.lesson) {
      const sameDateCampus = lessons.filter((lesson) => lesson.lesson_date === notionDate.slice(0, 10) && normalizeCampus(lesson.campus) === normalizeCampus(notionCampus));
      plans.push({
        status: "unresolved",
        reason: `授業候補が${resolved.matches.length}件`,
        event,
        currentLesson,
        roster,
        notion: { notionDate, notionCampus, notionLesson },
        candidateLessonIds: resolved.matches.map((lesson) => lesson.id),
        sameDateCampusLessons: sameDateCampus.map((lesson) => ({ id: lesson.id, label: lesson.label, identity: lessonNotionIdentity(lesson), source_payload: lesson.source_payload })),
      });
      continue;
    }
    if (resolved.lesson.id === event.lesson_id && notionDate === event.event_date) {
      plans.push({ status: "overrideable", reason: "Notionに別校舎受講として登録済み", event, currentLesson, roster, notion: { notionDate, notionCampus, notionLesson }, targetLesson: resolved.lesson });
      continue;
    }
    const { data: conflict, error: conflictError } = await supabase
      .from("attendance_events")
      .select("id")
      .eq("student_number", event.student_number)
      .eq("lesson_id", resolved.lesson.id)
      .neq("id", event.id)
      .maybeSingle();
    if (conflictError) throw conflictError;
    if (conflict) {
      plans.push({ status: "duplicate", reason: `Notion正本と同じ既存イベント${conflict.id}あり`, conflictEventId: conflict.id, event, currentLesson, roster, notion: { notionDate, notionCampus, notionLesson }, targetLesson: resolved.lesson });
      continue;
    }
    plans.push({ status: "repairable", event, currentLesson, roster, notion: { notionDate, notionCampus, notionLesson }, targetLesson: resolved.lesson });
  } catch (cause) {
    plans.push({ status: "unresolved", reason: cause instanceof Error ? cause.message : String(cause), event, currentLesson, roster });
  }
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const outputDir = path.resolve("analysis_outputs");
fs.mkdirSync(outputDir, { recursive: true });
const summary = {
  generated_at: new Date().toISOString(),
  since,
  apply,
  confirmed_event_count: events.length,
  mismatch_count: mismatches.length,
  repairable_count: plans.filter((plan) => plan.status === "repairable").length,
  overrideable_count: plans.filter((plan) => plan.status === "overrideable").length,
  duplicate_count: plans.filter((plan) => plan.status === "duplicate").length,
  unresolved_count: plans.filter((plan) => plan.status === "unresolved").length,
  plans,
};
const reportPath = path.join(outputDir, `attendance_campus_repair_${apply ? "apply" : "dry_run"}_${stamp}.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

if (apply) {
  const actionable = plans.filter((plan) => ["repairable", "overrideable", "duplicate"].includes(plan.status));
  const sourceItemIds = actionable.map((plan) => plan.event.source_candidate_item_id).filter(Boolean);
  const sourceCandidateIds = actionable.map((plan) => plan.event.source_candidate_id).filter(Boolean);
  const [candidateItemsResult, candidatesResult] = await Promise.all([
    sourceItemIds.length ? supabase.from("attendance_candidate_items").select("*").in("id", sourceItemIds) : Promise.resolve({ data: [], error: null }),
    sourceCandidateIds.length ? supabase.from("attendance_candidates").select("*").in("id", sourceCandidateIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (candidateItemsResult.error) throw candidateItemsResult.error;
  if (candidatesResult.error) throw candidatesResult.error;
  const backup = { generated_at: new Date().toISOString(), events: actionable.map((plan) => plan.event), candidate_items: candidateItemsResult.data ?? [], candidates: candidatesResult.data ?? [] };
  const backupPath = path.join(outputDir, `attendance_campus_repair_backup_${stamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");

  for (const plan of actionable) {
    const before = plan.event;
    const isOverride = plan.status === "overrideable";
    const isDuplicate = plan.status === "duplicate";
    const targetIsCrossCampus = normalizeCampus(plan.roster?.campus) !== normalizeCampus(plan.targetLesson?.campus);
    const update = isDuplicate ? {
      status: "cancelled",
      cancelled_by: "repair-attendance-campus-from-notion.mjs",
      cancelled_at: new Date().toISOString(),
    } : isOverride ? {
      lesson_id: before.lesson_id,
      event_date: before.event_date,
      cross_campus_override: true,
      cross_campus_reason: "Notion登録済み別校舎受講（校舎整合監査2026-08-27）",
    } : {
      lesson_id: plan.targetLesson.id,
      event_date: plan.notion.notionDate.slice(0, 10),
      cross_campus_override: targetIsCrossCampus,
      cross_campus_reason: targetIsCrossCampus ? "Notion登録済み別校舎受講（校舎整合監査2026-08-27）" : null,
    };
    const { data: after, error: updateError } = await supabase.from("attendance_events").update(update).eq("id", before.id).select("*").single();
    if (updateError) throw updateError;
    if (!isDuplicate && before.source_candidate_item_id) {
      const { error } = await supabase.from("attendance_candidate_items").update({ lesson_id: update.lesson_id, event_date: update.event_date, cross_campus_override: false, cross_campus_reason: null }).eq("id", before.source_candidate_item_id).eq("lesson_id", before.lesson_id);
      if (error) throw error;
    }
    if (!isDuplicate && before.source_candidate_id) {
      const { error } = await supabase.from("attendance_candidates").update({ lesson_id: update.lesson_id, event_date: update.event_date }).eq("id", before.source_candidate_id).eq("lesson_id", before.lesson_id);
      if (error) throw error;
    }
    const { error: auditError } = await supabase.from("attendance_event_audit_logs").insert({
      event_id: before.id,
      action: isDuplicate ? "cancel_duplicate_from_notion" : (isOverride || targetIsCrossCampus) ? "mark_cross_campus_from_notion" : "repair_campus_from_notion",
      actor: "repair-attendance-campus-from-notion.mjs",
      before_data: before,
      after_data: after,
    });
    if (auditError) throw auditError;
  }
  console.log(JSON.stringify({ ok: true, repaired: summary.repairable_count, marked_cross_campus: summary.overrideable_count, cancelled_duplicates: summary.duplicate_count, unresolved: summary.unresolved_count, report: reportPath, backup: backupPath }, null, 2));
} else {
  console.log(JSON.stringify({ ok: true, dry_run: true, mismatches: summary.mismatch_count, repairable: summary.repairable_count, overrideable: summary.overrideable_count, duplicates: summary.duplicate_count, unresolved: summary.unresolved_count, report: reportPath }, null, 2));
}
