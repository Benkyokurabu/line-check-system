import assert from "node:assert/strict";
import test from "node:test";
import { planStudentImport } from "../src/lib/student-import-guard.mjs";

const student = (number, extra = {}) => ({ student_number: number, student_name: "架空 一郎", grade: "中3", campus: "南教室", ...extra });
test("健全な生徒は反映し、同名別番号は自動統合せず保留する", () => {
  const result = planStudentImport([student("2018267"), student("2020001", { student_name: "架空 二郎" })], [student("2018200")]);
  assert.deepEqual(result.safe.map(row => row.student_number), ["2020001"]);
  assert.deepEqual(result.held_student_numbers, ["2018267"]);
});
test("同じ番号の重複をMapで消す前に双方を保留する", () => {
  const result = planStudentImport([student("2018267"), student("2018267", { student_name: "別の生徒" })], []);
  assert.equal(result.safe.length, 0);
  assert.ok(result.issues.some(issue => issue.reason.includes("複数")));
});
test("氏名が変わっても安定したNotionページIDで番号変更を検知する", () => {
  const result = planStudentImport([student("2018267", { notion_page_id: "a-b" })], [], [{ notion_page_id: "ab", student_number: "2018200" }]);
  assert.equal(result.safe.length, 0);
  assert.ok(result.issues.some(issue => issue.previous_student_number === "2018200"));
});
test("明示的に確認済みの番号訂正だけを許可し、旧番号の再取り込みを止める", () => {
  const aliases = [{ from: "2018200", to: "2018267", verified: true }];
  assert.equal(planStudentImport([student("2018267")], [student("2018200")], [], aliases).safe.length, 1);
  assert.equal(planStudentImport([student("2018200")], [], [], aliases).safe.length, 0);
  assert.equal(planStudentImport([student("2018267")], [student("2018200")], [], [{ ...aliases[0], verified: false }]).safe.length, 0);
});
test("既存番号を異なる氏名で上書きしない、空白だけの表記差は許可する", () => {
  assert.equal(planStudentImport([student("2018267", { student_name: "別人" })], [student("2018267")]).safe.length, 0);
  assert.equal(planStudentImport([student("2018267", { student_name: "架 空　一 郎" })], [student("2018267")]).safe.length, 1);
});
test("同名でも学年や教室が異なる生徒を保留せず、番号の桁誤りを保留する", () => {
  assert.equal(planStudentImport([student("2018267")], [student("2018200", { grade: "中2" })]).safe.length, 1);
  assert.equal(planStudentImport([student("201826")], []).safe.length, 0);
});

test("番号未登録のNotionプロフィールを番号変更と誤判定しない", () => {
  assert.equal(planStudentImport([student("2018267", { notion_page_id: "ab" })], [], [{ notion_page_id: "ab", student_number: null }]).safe.length, 1);
});
