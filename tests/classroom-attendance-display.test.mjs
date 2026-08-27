import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceReasonPropertyNames,
  attendanceTypePropertyNames,
  classroomEventTypeLabel,
  notionClassroomEventTypeLabel,
  normalizeClassroomEventType,
} from "../src/lib/classroom-attendance-display.mjs";
import {
  enrollmentMatchesLesson,
  resolveNotionLesson,
  shouldDisplayAttendanceEvent,
  validateAttendanceCampusSelection,
} from "../src/lib/attendance-campus-consistency.mjs";

test("Notionの選択文言を教室表示へそのまま渡す", () => {
  assert.equal(classroomEventTypeLabel("absence", "オンライン参加"), "オンライン参加");
  assert.equal(classroomEventTypeLabel("absence", "欠席"), "欠席");
});

test("Notion以外の既存データは従来の表示名を維持する", () => {
  assert.equal(classroomEventTypeLabel("late", null), "遅刻");
  assert.equal(classroomEventTypeLabel("early_leave", null), "早退");
  assert.equal(classroomEventTypeLabel("absence", null), "欠席");
});

test("Notionの選択が空欄なら欠席と決めつけず未選択と表示する", () => {
  assert.equal(notionClassroomEventTypeLabel(null), "未選択");
  assert.equal(notionClassroomEventTypeLabel("  "), "未選択");
  assert.equal(notionClassroomEventTypeLabel(" オンライン参加 "), "オンライン参加");
});

test("選択文言から既存の並び順・色分け用種別を作る", () => {
  assert.equal(normalizeClassroomEventType("遅刻"), "late");
  assert.equal(normalizeClassroomEventType("早退"), "early_leave");
  assert.equal(normalizeClassroomEventType("オンライン参加"), "absence");
});

test("Notionの新しい選択・理由列を読み書きの最優先候補にする", () => {
  assert.deepEqual(attendanceTypePropertyNames("種別"), ["選択", "種別", "区分"]);
  assert.deepEqual(attendanceReasonPropertyNames("（旧）理由"), ["理由", "理由等", "連絡名"]);
  assert.deepEqual(attendanceReasonPropertyNames("独自理由"), ["理由", "理由等", "独自理由", "連絡名"]);
});

test("同名クラスでも本校生徒に南教室の授業を推薦しない", () => {
  const enrollment = { grade: "中2", class_name: "A", subject: "数学" };
  assert.equal(enrollmentMatchesLesson(enrollment, { grade: "中2", class_name: "A", subject: "数学", campus: "本校" }, "本校"), true);
  assert.equal(enrollmentMatchesLesson(enrollment, { grade: "中2", class_name: "A", subject: "数学", campus: "南教室" }, "本校"), false);
});

test("同名クラスでも南教室生徒に本校の授業を推薦しない", () => {
  const enrollment = { grade: "中2", class_name: "B", subject: "英語" };
  assert.equal(enrollmentMatchesLesson(enrollment, { grade: "中2", class_name: "B", subject: "英語", campus: "南教室" }, "南教室"), true);
  assert.equal(enrollmentMatchesLesson(enrollment, { grade: "中2", class_name: "B", subject: "英語", campus: "本校" }, "南教室"), false);
});

test("校舎不一致は拒否し、明示的な別校舎受講と理由がある場合だけ許可する", () => {
  assert.equal(validateAttendanceCampusSelection({ studentCampus: "本校", lessonCampus: "南教室" }).ok, false);
  assert.equal(validateAttendanceCampusSelection({ studentCampus: "本校", lessonCampus: "南教室", crossCampusOverride: true }).ok, false);
  assert.equal(validateAttendanceCampusSelection({ studentCampus: "本校", lessonCampus: "南教室", crossCampusOverride: true, crossCampusReason: "振替受講" }).ok, true);
});

test("Notionの日付・授業校舎・授業名から授業を一意に解決する", () => {
  const lessons = [
    { id: "main", lesson_date: "2026-08-26", campus: "本校", grade: "中2", class_name: "B", subject: "英語", source_payload: { grade: "j2", class: "B", subject: "eng" } },
    { id: "south", lesson_date: "2026-08-26", campus: "南教室", grade: "中2", class_name: "B", subject: "英語", source_payload: { grade: "j2", class: "B", subject: "eng" } },
  ];
  const resolved = resolveNotionLesson(lessons, { date: "2026-08-26", campus: "本校", lessonName: "２Ｂ英" });
  assert.equal(resolved.lesson?.id, "main");
  assert.equal(resolved.matches.length, 1);
});

test("教室表示は校舎不一致を隠し、明示的な別校舎受講は表示する", () => {
  assert.equal(shouldDisplayAttendanceEvent({ studentCampus: "本校", lessonCampus: "南教室" }), false);
  assert.equal(shouldDisplayAttendanceEvent({ studentCampus: "本校", lessonCampus: "南教室", crossCampusOverride: true, crossCampusReason: "振替受講" }), true);
});
