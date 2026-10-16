import assert from "node:assert/strict";
import test from "node:test";
import { buildStudentSearchOptions, canonicalStudentSuggestions } from "../src/lib/student-search-options.mjs";
import { readFile } from "node:fs/promises";

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

const duplicateRows = [
  { student_number: "CURRENT", student_name: "試験 一 郎", grade: "中3", campus: "南教室", source_file: "中3クラス一覧表.xlsx" },
  { student_number: "OLD", student_name: "試験　一郎", grade: "中3", campus: "南教室", source_file: "Notion生徒情報DB" },
  { student_number: "notion:page", student_name: "試験　一郎", grade: "中3", campus: "南教室", source_file: "Notion生徒情報DB" },
];
const verifiedAliases = [
  { from: "OLD", to: "CURRENT", verified: true },
  { from: "notion:page", to: "CURRENT", verified: true },
];

test("現在の番号との対応を確認済みの古いNotion番号と仮番号だけを候補で整理する", () => {
  const before = structuredClone(duplicateRows);
  const options = buildStudentSearchOptions(duplicateRows, verifiedAliases);
  assert.equal(options.length, 1);
  assert.equal(options[0].student_number, "CURRENT");
  assert.deepEqual(options[0].merged_student_numbers, ["OLD", "notion:page"]);
  assert.deepEqual(options[0].notion_page_ids, ["page"]);
  assert.equal(options[0].merged_record_count, 2);
  assert.deepEqual(duplicateRows, before);
  assert.equal(buildStudentSearchOptions(duplicateRows).length, 3);
});

test("未確認・別人・別学年・別校舎・存在しない番号の対応では統合しない", () => {
  for (const patch of [{ student_name: "別人" }, { grade: "中2" }, { campus: "本校" }, { source_file: "別のクラス一覧表.xlsx" }]) {
    const rows = [duplicateRows[0], { ...duplicateRows[1], ...patch }];
    assert.equal(buildStudentSearchOptions(rows, verifiedAliases).length, 2);
  }
  for (const alias of [{ from: "OLD", to: "CURRENT", verified: false }, { from: "OLD", to: "MISSING", verified: true }]) {
    assert.equal(buildStudentSearchOptions(duplicateRows.slice(0, 2), [alias]).length, 2);
  }
});

test("同名でも正式名簿の別生徒は残し、候補の点数と確認済み選択を保持する", () => {
  const other = { ...duplicateRows[0], student_number: "OTHER" };
  const options = buildStudentSearchOptions([...duplicateRows, other], verifiedAliases);
  assert.equal(options.length, 2);
  const suggestions = duplicateRows.map((row, index) => ({ ...row, score: 110 - index * 10, reason: index ? "氏名一致" : "確認済みLINE登録" }));
  const result = canonicalStudentSuggestions([...suggestions, { ...other, score: 80, reason: "氏名一致" }], options);
  assert.equal(result.length, 2);
  assert.equal(result[0].student_number, "CURRENT");
  assert.equal(result[0].score, 110);
  assert.equal(result[0].reason, "確認済みLINE登録");
  const humanReviewed = canonicalStudentSuggestions(suggestions, options, "OLD");
  assert.equal(humanReviewed.length, 1);
  assert.equal(humanReviewed[0].student_number, "OLD");
});

test("欠席候補・生徒検索・LINE登録のすべてが同じ確認済み番号対応を使用する", async () => {
  for (const route of ["attendance/candidates", "attendance/students", "admin/contacts/students"]) {
    const source = await readFile(new URL(`../src/app/api/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /loadStudentIdentityAliases/);
    assert.match(source, /buildStudentSearchOptions\([^;]*identityAliases/);
  }
});

test("旧クラス名簿番号は現行名簿とNotionの照合根拠がそろう場合だけ整理する", () => {
  const rows = [duplicateRows[0], { ...duplicateRows[1], source_file: "中3クラス一覧表.xlsx" }];
  const evidence = { basis_type: "current_roster_and_notion", notion_student_number: "CURRENT", roster_student_number: "CURRENT", old_number_absent_from_roster: true, roster_sha256: "a".repeat(64) };
  const alias = { from: "OLD", to: "CURRENT", verified: true, evidence };
  assert.equal(buildStudentSearchOptions(rows, [alias]).length, 1);
  for (const patch of [{ old_number_absent_from_roster: false }, { notion_student_number: "OTHER" }, { roster_student_number: "OTHER" }, { roster_sha256: "" }, { basis_type: "name_only" }]) {
    assert.equal(buildStudentSearchOptions(rows, [{ ...alias, evidence: { ...evidence, ...patch } }]).length, 2);
  }
});
