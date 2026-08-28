import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  attendanceEventType,
  expandAttendanceDates,
  fallbackAttendanceReason,
  normalizeAttendanceItems,
  normalizeAttendanceText,
} from "../src/lib/attendance-extract-logic.mjs";
import { detectExplicitLineIdentities } from "../src/lib/line-identity-detection.mjs";
import {
  actionCandidatesForReview,
  visibleCandidateCountAfterReload,
} from "../src/lib/attendance-review-logic.mjs";

const identityStudents = [
  { student_number: "1001", student_name: "山田 太郎" },
  { student_number: "1002", student_name: "髙橋 花子" },
];

test("explicit LINE identity statements detect the student and relationship", () => {
  assert.deepEqual(detectExplicitLineIdentities("こんにちは。山田太郎の母です。", identityStudents), [{
    student_number: "1001",
    student_name: "山田 太郎",
    relation: "mother",
  }]);
  assert.equal(detectExplicitLineIdentities("山田 太郎本人です！", identityStudents)[0]?.relation, "student");
  assert.equal(detectExplicitLineIdentities("生徒の高橋花子です。", identityStudents)[0]?.relation, "student");
  assert.equal(detectExplicitLineIdentities("山田太郎の父です、よろしくお願いします。", identityStudents)[0]?.relation, "father");
});

test("LINE identity detection rejects questions and non-explicit name mentions", () => {
  assert.deepEqual(detectExplicitLineIdentities("山田太郎の母ですか？", identityStudents), []);
  assert.deepEqual(detectExplicitLineIdentities("山田太郎は欠席します。", identityStudents), []);
  assert.deepEqual(detectExplicitLineIdentities("山田太郎です。", identityStudents), []);
});

test("ambiguous LINE identity messages remain distinguishable for manual exclusion", () => {
  const matches = detectExplicitLineIdentities("山田太郎の母です。高橋花子の母です。", identityStudents);
  assert.equal(matches.length, 2);
});

test("date ranges are expanded into one registration row per day", () => {
  assert.deepEqual(expandAttendanceDates("2026-07-23", "2026-07-25"), [
    "2026-07-23",
    "2026-07-24",
    "2026-07-25",
  ]);
});

test("invalid or reversed ranges stay conservative", () => {
  assert.deepEqual(expandAttendanceDates("", "2026-07-25"), []);
  assert.deepEqual(expandAttendanceDates("2026-07-25", "2026-07-23"), ["2026-07-25"]);
});


test("name text treats 高 and 髙 as the same character", () => {
  assert.equal(normalizeAttendanceText("髙田 真帆"), normalizeAttendanceText("高田真帆"));
});
test("unknown event types are normalized to other", () => {
  assert.equal(attendanceEventType("absence"), "absence");
  assert.equal(attendanceEventType("late"), "late");
  assert.equal(attendanceEventType("unexpected"), "other");
});

test("AI items can represent multiple same-day lessons", () => {
  const rows = normalizeAttendanceItems({
    is_attendance: true,
    student_name: "伊原さくら",
    confidence: 0.99,
    items: [
      { event_type: "absence", event_date: "2026-07-23", subject: "英語", class_name: "6A", summary: "体調不良" },
      { event_type: "absence", event_date: "2026-07-23", subject: "数学", class_name: "6A", summary: "体調不良" },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.suggested_subject), ["英語", "数学"]);
  assert.ok(rows.every((row) => row.event_date === "2026-07-23"));
});

test("date range items are expanded and keep the reason", () => {
  const rows = normalizeAttendanceItems({
    is_attendance: true,
    items: [
      { event_type: "absence", date_start: "2026-07-23", date_end: "2026-07-25", summary: "合宿" },
    ],
  });
  assert.deepEqual(rows.map((row) => row.event_date), ["2026-07-23", "2026-07-24", "2026-07-25"]);
  assert.ok(rows.every((row) => row.ai_summary === "合宿"));
});

test("legacy single AI result still creates one registration row", () => {
  const rows = normalizeAttendanceItems({
    is_attendance: true,
    event_type: "late",
    event_date: "2026-07-23",
    summary: "交通事情",
  });
  assert.deepEqual(rows, [{
    event_type: "late",
    event_date: "2026-07-23",
    suggested_subject: null,
    suggested_class_name: null,
    ai_summary: "交通事情",
  }]);
});

test("duplicate AI rows are collapsed", () => {
  const rows = normalizeAttendanceItems({
    is_attendance: true,
    items: [
      { event_type: "absence", event_date: "2026-07-23", subject: " 英語 ", class_name: "6A", summary: "体調不良" },
      { event_type: "absence", event_date: "2026-07-23", subject: "英語", class_name: "６Ａ", summary: "体調不良" },
    ],
  });
  assert.equal(rows.length, 1);
});

test("fallback reasons are stable", () => {
  assert.equal(fallbackAttendanceReason("absence"), "欠席連絡");
  assert.equal(fallbackAttendanceReason("late"), "遅刻連絡");
  assert.equal(fallbackAttendanceReason("reschedule_request"), "振替希望");
  assert.equal(fallbackAttendanceReason("other"), "連絡");
});

test("attendance schema contains the child table required for multi-row registration", async () => {
  const sql = await readFile(new URL("../supabase/attendance_schema.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.attendance_candidate_items/);
  assert.match(sql, /candidate_id uuid not null references public\.attendance_candidates/);
  assert.match(sql, /lesson_id uuid references public\.lessons/);
  assert.match(sql, /status text not null default 'pending'/);
  assert.match(sql, /attendance_candidate_items_status_check/);
  assert.match(sql, /cross_campus_override boolean not null default false/);
  assert.match(sql, /attendance_events_cross_campus_reason_check/);
});

test("all attendance write APIs enforce campus consistency", async () => {
  const routes = await Promise.all([
    readFile(new URL("../src/app/api/attendance/candidates/[id]/confirm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/events/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  for (const route of routes) assert.match(route, /validateAttendanceCampusSelection/);
});

test("attendance campus checks use subject enrollment classroom", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/app/api/attendance/lessons/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/candidates/[id]/confirm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/events/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  for (const file of files) {
    assert.match(file, /student_class_enrollments/);
    assert.match(file, /classroom/);
  }
});

test("attendance analysis uses a durable queue without a rolling lookback", async () => {
  const [sql, worker] = await Promise.all([
    readFile(new URL("../supabase/attendance_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/attendance-ai-extraction.ts", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /create table if not exists public\.attendance_analysis_jobs/);
  assert.match(sql, /create trigger enqueue_attendance_analysis_job_on_line_message/);
  assert.match(sql, /for update of jobs skip locked/);
  assert.match(sql, /jobs\.priority desc/);
  assert.match(worker, /claim_pending_attendance_jobs/);
  assert.doesNotMatch(worker, /ATTENDANCE_LOOKBACK_HOURS|p_since: since/);
});

test("attendance analysis retries transient failures and dead-letters exhausted jobs", async () => {
  const worker = await readFile(new URL("../src/lib/attendance-ai-extraction.ts", import.meta.url), "utf8");
  assert.match(worker, /ATTENDANCE_MAX_ATTEMPTS = 8/);
  assert.match(worker, /ATTENDANCE_RETRY_DELAYS_MINUTES = \[5, 15, 60, 180, 360, 720, 1440\]/);
  assert.match(worker, /isDead \? "dead" : "retry_wait"/);
  assert.match(worker, /AttendanceRateLimitError/);
  assert.match(worker, /rate_limited_until/);
});

test("attendance scheduler reads its bearer token from Supabase Vault", async () => {
  const scheduler = await readFile(new URL("../scripts/configure-attendance-cron.mjs", import.meta.url), "utf8");
  assert.match(scheduler, /vault\.decrypted_secrets/);
  assert.match(scheduler, /attendance-analysis-worker/);
  assert.match(scheduler, /attendance-analysis-monitor/);
  assert.doesNotMatch(scheduler, /Authorization', 'Bearer [A-Za-z0-9_-]{20}/);
});

test("attendance LINE replies are locked after sending unless additional-message mode is explicit", async () => {
  const [page, replyRoute] = await Promise.all([
    readFile(new URL("../src/app/attendance/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/candidates/[id]/reply/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /LINEで送信済み/);
  assert.match(page, /別のメッセージを送る/);
  assert.match(page, /allow_additional: hasSentReply && additionalMessageMode/);
  assert.match(page, /onChanged=\{\(\) => load\(candidate\.id, reviewTab\)\}/);
  assert.match(page, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(replyRoute, /if \(existingReply && !allowAdditional\)/);
  assert.match(replyRoute, /LINE_ALREADY_SENT/);
});

function reviewCandidate(id, overrides = {}) {
  return {
    id,
    status: "pending",
    notion_error: null,
    attendance_candidate_items: [],
    student_selection_required: false,
    reply_status: { sent: false },
    ...overrides,
  };
}

test("a LINE reply keeps an incomplete candidate in the same visible position", () => {
  const beforeReply = Array.from({ length: 25 }, (_, index) => reviewCandidate(`candidate-${index}`));
  beforeReply[0] = reviewCandidate("operated");
  const candidates = beforeReply.map((candidate) => candidate.id === "operated"
    ? { ...candidate, reply_status: { sent: true } }
    : candidate);

  assert.equal(actionCandidatesForReview(beforeReply).findIndex((candidate) => candidate.id === "operated"), 0);
  assert.equal(actionCandidatesForReview(candidates).findIndex((candidate) => candidate.id === "operated"), 0);
  assert.equal(visibleCandidateCountAfterReload({
    candidates,
    reviewTab: "action",
    keepVisibleCandidateId: "operated",
    currentCount: 20,
  }), 20);
});

test("guardian linking keeps an incomplete candidate in the same visible position", () => {
  const beforeLinking = Array.from({ length: 25 }, (_, index) => reviewCandidate(`candidate-${index}`));
  beforeLinking[0] = reviewCandidate("linked-guardian", { student_selection_required: true });
  const candidates = beforeLinking.map((candidate) => candidate.id === "linked-guardian"
    ? { ...candidate, student_selection_required: false }
    : candidate);

  assert.equal(actionCandidatesForReview(beforeLinking).findIndex((candidate) => candidate.id === "linked-guardian"), 0);
  assert.equal(actionCandidatesForReview(candidates).findIndex((candidate) => candidate.id === "linked-guardian"), 0);
  assert.equal(visibleCandidateCountAfterReload({
    candidates,
    reviewTab: "action",
    keepVisibleCandidateId: "linked-guardian",
    currentCount: 20,
  }), 20);
});

test("Notion errors stay first without reordering other incomplete candidates", () => {
  const candidates = [
    reviewCandidate("first-normal"),
    reviewCandidate("notion-error", { notion_error: "failed" }),
    reviewCandidate("second-normal"),
  ];
  assert.deepEqual(actionCandidatesForReview(candidates).map((candidate) => candidate.id), [
    "notion-error",
    "first-normal",
    "second-normal",
  ]);
});

test("Notion completion intentionally moves a candidate out of the action tab", () => {
  const candidates = [reviewCandidate("registered", { status: "confirmed" })];
  assert.equal(visibleCandidateCountAfterReload({
    candidates,
    reviewTab: "action",
    keepVisibleCandidateId: "registered",
    currentCount: 20,
  }), 20);
});

test("ordinary attendance refresh keeps the normal 20-card page size", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => reviewCandidate(`candidate-${index}`));
  assert.equal(visibleCandidateCountAfterReload({
    candidates,
    reviewTab: "action",
    currentCount: 25,
  }), 20);
});

test("candidate draft replacement and dismissal are atomic database operations", async () => {
  const [schema, migration, candidateRoute] = await Promise.all([
    readFile(new URL("../supabase/attendance_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/attendance_operation_safety_20260828.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/candidates/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /create or replace function public\.replace_attendance_candidate_draft/);
  assert.match(schema, /create or replace function public\.dismiss_attendance_candidate/);
  assert.match(schema, /delete from public\.attendance_candidate_items[\s\S]*insert into public\.attendance_candidate_items/);
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /revoke all on function public\.replace_attendance_candidate_draft\(uuid, jsonb, jsonb\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.dismiss_attendance_candidate\(uuid, text\) to service_role/);
  assert.match(migration, /from public\.attendance_events[\s\S]*status <> 'cancelled'[\s\S]*一部登録済みの候補は対応不要にできません/);
  assert.match(migration, /status = 'confirmed'[\s\S]*continue;[\s\S]*editable_count := editable_count \+ 1/);
  assert.match(candidateRoute, /id: cleanUuid\(item\.id\)/);
  assert.match(candidateRoute, /rpc\("replace_attendance_candidate_draft"/);
  assert.match(candidateRoute, /rpc\("dismiss_attendance_candidate"/);
  assert.doesNotMatch(candidateRoute, /\.from\("attendance_candidate_items"\)\s*\.delete\(\)/);
});

test("stale candidate registration can recover without reopening a live concurrent operation", async () => {
  const [confirmRoute, candidatesRoute, page] = await Promise.all([
    readFile(new URL("../src/app/api/attendance/candidates/[id]/confirm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/candidates/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/attendance/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(confirmRoute, /Date\.now\(\) - Date\.parse\(String\(candidate\.updated_at\)\) > 15 \* 60 \* 1000/);
  assert.match(confirmRoute, /candidate\.status === "registering" && !staleRegistering[\s\S]*別の登録処理が進行中です/);
  assert.match(confirmRoute, /allItems\.some\(\(item\) => item\.status === "confirmed"\)[\s\S]*allItems\.every\(\(item\) => item\.status === "confirmed" \|\| item\.status === "dismissed"\)/);
  assert.match(confirmRoute, /recovered_stale_registration: true/);
  assert.match(confirmRoute, /staleRegistering \? \["pending", "notion_failed", "registering"\]/);
  assert.match(candidatesRoute, /\.in\("status", \["pending", "notion_failed", "registering"\]\)/);
  assert.match(page, /登録処理中（15分超で再試行可）/);
  assert.match(page, /registering \? "登録状態を確認・再試行"/);
});

test("initial LINE reply is claimed before the external send and duplicate claims are rejected", async () => {
  const [schema, replyRoute] = await Promise.all([
    readFile(new URL("../supabase/attendance_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/candidates/[id]/reply/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /line_messages_attendance_initial_reply_unique/);
  assert.match(replyRoute, /attendance_reply_initial_\$\{id\}/);
  assert.match(replyRoute, /replyKind === "initial" && claimResult\.error\.code === "23505"/);
  assert.ok(replyRoute.indexOf("claimResult") < replyRoute.indexOf('fetch("https://api.line.me/v2/bot/message/push"'));
  assert.match(replyRoute, /send_status: "sending"/);
  assert.match(replyRoute, /send_status: "accepted"/);
  assert.match(replyRoute, /send_status: "unknown"/);
  assert.match(replyRoute, /line_delivery_unknown: true/);
  assert.doesNotMatch(replyRoute, /catch \(cause\)[\s\S]{0,300}\.delete\(\)/);
});

test("all user-triggered attendance mutations surface failures and prevent repeat clicks", async () => {
  const page = await readFile(new URL("../src/app/attendance/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(body\.notion_failed\)[\s\S]*データは保存しましたが、Notion反映に失敗しました/);
  assert.match(page, /const \[actionBusy, setActionBusy\]/);
  assert.match(page, /disabled=\{Boolean\(actionBusy\)\}/);
  assert.match(page, /body: JSON\.stringify\(\{ dismissed_by: confirmedBy \}\)/);
  assert.match(page, /if \(!response\.ok\) throw new Error\(body\.error \?\? "対応不要の処理に失敗しました"\)/);
  assert.match(page, /コピーできませんでした。返信文を選択してコピーしてください/);
});

test("manual edit and cancellation require an actor and cancellation is recorded before Notion archive", async () => {
  const [eventsRoute, eventRoute] = await Promise.all([
    readFile(new URL("../src/app/api/attendance/events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/events/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(eventsRoute, /if \(!receivedBy\) throw new Error\("受付者名を入力してください"\)/);
  assert.match(eventRoute, /if \(!receivedBy\) throw new Error\("受付者名を入力してください"\)/);
  assert.match(eventRoute, /if \(!cancelledBy\) return NextResponse\.json\(\{ error: "確認者名を入力してください"/);
  assert.ok(eventRoute.indexOf('status: "cancelled"') < eventRoute.indexOf("await archiveAttendanceNotionPage"));
  assert.match(eventRoute, /already_cancelled: true/);
});

test("partial sibling LINE linking remains reviewable until the last account succeeds", async () => {
  const [page, linkRoute, candidatesRoute] = await Promise.all([
    readFile(new URL("../src/app/attendance/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/students/[studentNumber]/link/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/line-link-candidates/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /confirm_evidence: index === targets\.length - 1/);
  assert.match(linkRoute, /const confirmEvidence = body\.confirm_evidence !== false/);
  assert.match(candidatesRoute, /linkedLineUserIds\.has\(lineUserId\) && !pendingEvidence/);
  assert.doesNotMatch(candidatesRoute, /evidence\.review_status !== "pending" \|\| linkedLineUserIds/);
});

test("lesson requests are cancelled when the selected date or student changes", async () => {
  const page = await readFile(new URL("../src/app/attendance/page.tsx", import.meta.url), "utf8");
  const abortControllerCount = page.match(/const controller = new AbortController\(\)/g)?.length ?? 0;
  const abortCleanupCount = page.match(/return \(\) => controller\.abort\(\)/g)?.length ?? 0;
  assert.equal(abortControllerCount, 3);
  assert.equal(abortCleanupCount, 3);
});

test("LINE identity candidates run at 06:00 JST and require manual review", async () => {
  const [vercelConfig, schema, candidateRoute, linkRoute] = await Promise.all([
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/attendance/line-link-candidates/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/students/[studentNumber]/link/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(vercelConfig, /"path": "\/api\/cron\/line-identity-candidates"[\s\S]*?"schedule": "0 21 \* \* \*"/);
  assert.match(schema, /review_status text not null default 'confirmed'/);
  assert.match(schema, /check \(review_status in \('pending', 'confirmed', 'rejected'\)\)/);
  assert.match(candidateRoute, /review_status: "rejected"/);
  assert.match(linkRoute, /review_status: "confirmed"/);
});
