import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  attendanceEventType,
  expandAttendanceDates,
  fallbackAttendanceReason,
  normalizeAttendanceItems,
} from "../src/lib/attendance-extract-logic.mjs";

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
});
