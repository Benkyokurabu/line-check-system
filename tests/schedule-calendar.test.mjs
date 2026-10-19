import test from "node:test";
import assert from "node:assert/strict";
import { calendarSchedulePayload, readCalendarSchedule } from "../src/lib/schedule-calendar.mjs";
import { scheduleRows } from "../src/lib/schedule-preview.mjs";

const month = "2026-11";
const events = ["hon", "minami"].map((campus) => ({ date: "2026-11-02", time: "5:00～6:00", campus, room: "1", groupKey: `${campus}_j1_S_math`, label: "中1S 数学", teacher: "工藤", grade: "j1", class: "S", subject: "math", faceToFace: false }));
const run = { id: "run", month, status: "applied", summary: { incoming: 2 }, finished_at: "2026-10-19T09:00:00Z", source: { file: "2026年11月スケジュール.xlsm", sha256: "abc", privateToken: "secret" } };
const rows = () => scheduleRows(events, month).map((row, i) => ({ ...row, id: `private-${i}`, source_payload: { ...row.source_payload, student: "PRIVATE", secret: "PRIVATE" } }));

test("student and teacher calendars use the same accepted events, with public fields only", () => {
  const result = calendarSchedulePayload(rows(), month, run);
  assert.equal(result.count, 2);
  assert.equal(result.teacherSchedule.items.length, 2);
  assert.deepEqual(result.teacherSchedule.teachers, ["工藤"]);
  assert.equal(result.teacherSchedule.items[1].campusLabel, "南教室");
  assert.equal(result.teacherSchedule.month, 11);
  assert(!JSON.stringify(result).includes("PRIVATE"));
  assert(!JSON.stringify(result).includes("secret"));
  assert(!JSON.stringify(result).includes("private-"));
});
test("incomplete/changed/duplicate data is never reported as published", () => {
  assert.throws(() => calendarSchedulePayload(rows(), month, null), /完了/);
  assert.throws(() => calendarSchedulePayload(rows(), month, { ...run, status: "review" }), /完了/);
  assert.throws(() => calendarSchedulePayload(rows().slice(0, 1), month, run), /件数/);
  const changed = rows(); changed[0].classroom = "2";
  assert.throws(() => calendarSchedulePayload(changed, month, run), /対応/);
  const duplicate = rows(); duplicate[1] = duplicate[0];
  assert.throws(() => calendarSchedulePayload(duplicate, month, run), /重複/);
});
test("target month and both campuses are required", () => {
  assert.throws(() => calendarSchedulePayload(rows(), "2026-10", run), /完了/);
  assert.throws(() => calendarSchedulePayload(rows().slice(0, 1), month, { ...run, summary: { incoming: 1 } }), /校舎/);
});

function database({ missing = false, fail = false, race = false, pagination = false } = {}) {
  let reads = 0;
  return { from(table) {
    const q = { select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, lt() { return q; }, order() { return q; },
      limit() { return Promise.resolve({ data: missing ? [] : [run], error: fail }); },
      range(offset) {
        if (pagination && offset === 0) return Promise.resolve({ data: Array.from({ length: 500 }, () => rows()[0]), error: null });
        reads++;
        const data = rows(); if (race && reads > 1) data[0].updated_at = "new";
        return Promise.resolve({ data, error: fail });
      } };
    assert(["lessons", "schedule_sync_runs"].includes(table));
    return q;
  } };
}
test("read-only store reads a stable accepted month", async () => {
  const result = await readCalendarSchedule(database(), month);
  assert.equal(result.count, 2);
});
test("no completed sync, database failures, invalid input, concurrent updates fail closed", async () => {
  await assert.rejects(readCalendarSchedule(database({ missing: true }), month), (e) => e.status === 404);
  await assert.rejects(readCalendarSchedule(database({ fail: true }), month), (e) => e.status === 503);
  await assert.rejects(readCalendarSchedule(database(), "2026-13"), (e) => e.status === 400);
  await assert.rejects(readCalendarSchedule(database({ race: true }), month), (e) => e.status === 409);
});
