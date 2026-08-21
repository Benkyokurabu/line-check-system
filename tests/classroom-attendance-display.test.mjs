import assert from "node:assert/strict";
import test from "node:test";
import {
  classroomEventTypeLabel,
  normalizeClassroomEventType,
} from "../src/lib/classroom-attendance-display.mjs";

test("Notionの選択文言を教室表示へそのまま渡す", () => {
  assert.equal(classroomEventTypeLabel("absence", "オンライン参加"), "オンライン参加");
  assert.equal(classroomEventTypeLabel("absence", "欠席"), "欠席");
});

test("Notion以外の既存データは従来の表示名を維持する", () => {
  assert.equal(classroomEventTypeLabel("late", null), "遅刻");
  assert.equal(classroomEventTypeLabel("early_leave", null), "早退");
  assert.equal(classroomEventTypeLabel("absence", null), "欠席");
});

test("選択文言から既存の並び順・色分け用種別を作る", () => {
  assert.equal(normalizeClassroomEventType("遅刻"), "late");
  assert.equal(normalizeClassroomEventType("早退"), "early_leave");
  assert.equal(normalizeClassroomEventType("オンライン参加"), "absence");
});
