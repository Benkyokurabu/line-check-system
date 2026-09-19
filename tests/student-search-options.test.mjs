import assert from "node:assert/strict";
import test from "node:test";
import { buildStudentSearchOptions } from "../src/lib/student-search-options.mjs";

test("同じ氏名・学年・校舎の正式名簿とNotion仮IDは正式名簿1件にまとめる", () => {
  const result = buildStudentSearchOptions([
    { student_number: "2020045", student_name: "横 関 亮 太", grade: "中1", campus: "本校", source_file: "中1クラス一覧表.xlsx" },
    { student_number: "notion:abc", student_name: "横関　亮太", grade: "中1", campus: "本校", source_file: "Notion生徒情報DB" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].student_number, "2020045");
  assert.deepEqual(result[0].merged_student_numbers, ["notion:abc"]);
  assert.equal(result[0].merged_record_count, 1);
});

test("同姓同名でも正式学籍番号が複数ある場合は自動統合しない", () => {
  const result = buildStudentSearchOptions([
    { student_number: "1", student_name: "山田 太郎", grade: "中1", campus: "本校" },
    { student_number: "2", student_name: "山田太郎", grade: "中1", campus: "本校" },
  ]);
  assert.equal(result.length, 2);
  assert.ok(result.every((row) => row.merged_record_count === 0));
});

test("学年または校舎が違う同名生徒は別候補のままにする", () => {
  const result = buildStudentSearchOptions([
    { student_number: "1", student_name: "山田 太郎", grade: "中1", campus: "本校" },
    { student_number: "notion:abc", student_name: "山田太郎", grade: "中2", campus: "本校" },
  ]);
  assert.equal(result.length, 2);
});
