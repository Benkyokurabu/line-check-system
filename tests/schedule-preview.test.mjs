import test from "node:test";
import assert from "node:assert/strict";
import { buildSchedulePreview, scheduleRows, readSchedulePreview } from "../src/lib/schedule-preview.mjs";
import { schedulePreviewHtml } from "../src/lib/schedule-preview-html.mjs";

const item = (extra = {}) => ({ date: "2026-09-07", time: "6:35～8:05", grade: "j1", class: "S", subject: "eng", campus: "hon", room: "1", groupKey: "hon_j1_S_eng", label: "中１S 英語", teacher: "テスト講師", ...extra });
const existing = (items) => scheduleRows(items, "2026-09").map((r, i) => ({ ...r, id: `lesson-${i}` }));
test("new month and identical repeat produce different plans without mutation", () => {
  const items = [item()]; const before = existing(items); const snapshot = structuredClone(before);
  assert.equal(buildSchedulePreview(items, [], "2026-09").summary.add, 1);
  assert.equal(buildSchedulePreview(items, before, "2026-09").summary.unchanged, 1);
  assert.deepEqual(before, snapshot);
});
test("time and room changes keep the original lesson identity in the proposed change", () => {
  const before = existing([item()]);
  const plan = buildSchedulePreview([item({ room: "2", time: "8:25～9:55" })], before, "2026-09", { "lesson-0": 2 });
  assert.equal(plan.summary.update, 1); assert.equal(plan.summary.add, 0); assert.equal(plan.summary.remove, 0);
  assert.equal(plan.changes[0].before.id, "lesson-0"); assert.equal(plan.changes[0].linkedRecords, 2);
  assert.ok(plan.requiresReview); assert.equal(plan.applied, false);
});
test("ambiguous multiple lessons must not be paired arbitrarily", () => {
  const before = existing([item(), item({ time: "8:25～9:55" })]);
  const plan = buildSchedulePreview([item({ room: "3" }), item({ time: "8:25～9:55", room: "4" })], before, "2026-09");
  assert.equal(plan.summary.ambiguous, 1); assert.equal(plan.summary.update, 0);
});
test("moving date or campus is a reviewable removal and addition, not an inferred transfer", () => {
  for (const change of [{ date: "2026-09-08" }, { campus: "minami", groupKey: "minami_j1_S_eng" }]) {
    const p = buildSchedulePreview([item(change)], existing([item()]), "2026-09");
    assert.equal(p.summary.remove, 1); assert.equal(p.summary.add, 1); assert.ok(p.requiresReview);
  }
});
test("teacher and face-to-face changes are detected even with the same key", () => {
  assert.equal(buildSchedulePreview([item({ teacher: "別の講師", faceToFace: true })], existing([item()]), "2026-09").summary.update, 1);
});
test("invalid inputs fail closed", () => {
  for (const rows of [[], [item(), item()], [item({ date: "2026-09-31" })], [item({ date: "2026-10-01" })], [item({ time: "25:00～26:00" })], [item({ room: "" })], [item({ campus: "unknown" })]]) {
    assert.throws(() => buildSchedulePreview(rows, [], "2026-09"));
  }
});
test("special lessons with no grade/class remain supported", () => {
  const p = buildSchedulePreview([item({ grade: "", class: "", subject: "", isSpecialLesson: true, groupKey: "hon_special_英検対策", label: "英検対策" })], [], "2026-09");
  assert.equal(p.summary.add, 1);
});
test("existing out-of-month or duplicate rows abort the preview", () => {
  const rows = existing([item()]);
  assert.throws(() => buildSchedulePreview([item()], [...rows, ...rows], "2026-09"));
  assert.throws(() => buildSchedulePreview([item()], [{ ...rows[0], lesson_date: "2026-08-31" }], "2026-09"));
});
test("browser recomputes report changes and does not trust saved summary", () => {
  const p = buildSchedulePreview([item()], [], "2026-09");
  const report = { ...p, summary: { add: 999 }, changes: [], generatedAt: new Date().toISOString(), source: { file: "test.xlsm" }, existing: [], references: {} };
  assert.equal(readSchedulePreview(report).summary.add, 1);
  assert.equal(readSchedulePreview(report).changes.length, 1);
  assert.throws(() => readSchedulePreview({ ...report, applied: true }));
});
test("standalone review escapes workbook text and forbids active content", () => {
  const p = buildSchedulePreview([item({ teacher: '<script>alert(1)</script>' })], [], "2026-09");
  const html = schedulePreviewHtml({ ...p, generatedAt: new Date().toISOString(), source: { file: "test.xlsm" }, existing: [], references: {} });
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("default-src 'none'"));
});
