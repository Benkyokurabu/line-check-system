import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as XLSXNamespace from "xlsx";

import {
  CANONICAL_ROSTER_DIRECTORY,
  fileManifest,
  listRosterExcelFiles,
  mergeNotionStudentWithExistingRoster,
  preserveExistingTeachers,
  readRosterExcelRows,
  resolveRosterExcelRoot,
} from "../src/lib/roster-import-logic.mjs";

const XLSX = "default" in XLSXNamespace ? XLSXNamespace.default : XLSXNamespace;

function writeRoster(filePath, rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["", "新中１ 現在クラス一覧表"],
    ["所属", "学籍番号", "本人氏名", "性別", "学校", "担任", "教室", "数学", "個別", "教室2", "英語", "個別5", "教室3", "国語"],
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "クラス一覧表");
  XLSX.writeFile(workbook, filePath);
}

test("正本フォルダがある場合はプロジェクト直下の旧コピーより優先する", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roster-root-"));
  const canonicalRoot = path.join(projectRoot, CANONICAL_ROSTER_DIRECTORY);
  fs.mkdirSync(canonicalRoot);
  const fileName = "・中１ クラス一覧表(2026).xlsx";
  writeRoster(path.join(projectRoot, fileName), [["本校", 2020998, "旧 生徒", "男", "北", "旧担任", "", "A"]]);
  writeRoster(path.join(canonicalRoot, fileName), [["本校", 2020999, "新 生徒", "女", "北", "新担任", "", "S"]]);

  assert.equal(resolveRosterExcelRoot(projectRoot), canonicalRoot);
  assert.deepEqual(listRosterExcelFiles(projectRoot), [fileName]);
  const manifest = fileManifest([fileName], projectRoot);
  assert.equal(manifest[0].size, fs.statSync(path.join(canonicalRoot, fileName)).size);
  const result = readRosterExcelRows([fileName], projectRoot);
  assert.deepEqual(result.rows.map((row) => row.student_number), ["2020999"]);
});

test("担任が空欄でも生徒とクラス所属を取り込む", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roster-blank-teacher-"));
  const fileName = "・中１ クラス一覧表(2026).xlsx";
  writeRoster(path.join(projectRoot, fileName), [["本校", 2020022, "小 松 雅", "女", "北", "", "", "B"]]);

  const result = readRosterExcelRows([fileName], projectRoot);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].homeroom_teacher, "未設定");
  assert.deepEqual(result.enrollments.map(({ student_number, subject, class_name }) => ({ student_number, subject, class_name })), [
    { student_number: "2020022", subject: "数学", class_name: "B" },
  ]);
});

test("Excelの担任が空欄なら既存DBの担任を維持する", async () => {
  const rows = [
    { student_number: "2020022", homeroom_teacher: "未設定" },
    { student_number: "2020999", homeroom_teacher: "未設定" },
    { student_number: "2020888", homeroom_teacher: "鈴木" },
  ];
  const supabase = {
    from(table) {
      assert.equal(table, "student_roster");
      return {
        select(columns) {
          assert.equal(columns, "student_number,homeroom_teacher");
          return {
            async in(column, values) {
              assert.equal(column, "student_number");
              assert.deepEqual(values, ["2020022", "2020999"]);
              return {
                data: [{ student_number: "2020022", homeroom_teacher: "金子" }],
                error: null,
              };
            },
          };
        },
      };
    },
  };

  const result = await preserveExistingTeachers(supabase, rows);
  assert.deepEqual(result.map((row) => row.homeroom_teacher), ["金子", "未設定", "鈴木"]);
});

test("Notion同期はExcel由来の名簿項目を上書きせず授業形態だけ補完する", () => {
  const updatedAt = "2026-09-03T00:00:00.000Z";
  const student = {
    student_number: "2019228",
    student_name: "Notion氏名",
    grade: "中2",
    homeroom_teacher: "Notion担任",
    campus: "南教室",
    school_name: "Notion中",
    gender: "男",
    instruction_type: "個別ほか",
  };
  const current = {
    student_number: "2019228",
    student_name: "Excel氏名",
    grade: "中2",
    homeroom_teacher: "Excel担任",
    campus: "本校",
    school_name: "Excel校",
    gender: "男",
    instruction_type: null,
    source_file: "・中２ クラス一覧表(2026).xlsx",
  };

  assert.deepEqual(mergeNotionStudentWithExistingRoster(student, current, updatedAt), {
    ...current,
    instruction_type: "個別ほか",
    updated_at: updatedAt,
  });
});

test("Notionのみの生徒はNotion情報で更新する", () => {
  const updatedAt = "2026-09-03T00:00:00.000Z";
  const student = {
    student_number: "notion:abc",
    student_name: "Notion氏名",
    grade: "中1",
    homeroom_teacher: "金子",
    campus: "本校",
    school_name: "北中",
    gender: "女",
    instruction_type: null,
  };
  const current = {
    ...student,
    student_name: "旧氏名",
    source_file: "Notion生徒情報DB",
  };

  assert.equal(mergeNotionStudentWithExistingRoster(student, current, updatedAt).student_name, "Notion氏名");
});

test("Excel由来でも担任が未設定ならNotionの担任で補完する", () => {
  const result = mergeNotionStudentWithExistingRoster(
    {
      student_number: "2020999",
      student_name: "Notion氏名",
      homeroom_teacher: "金子",
    },
    {
      student_number: "2020999",
      student_name: "Excel氏名",
      grade: "中1",
      homeroom_teacher: "未設定",
      campus: "本校",
      school_name: "北",
      gender: "女",
      instruction_type: null,
      source_file: "・中１ クラス一覧表(2026).xlsx",
    },
  );

  assert.equal(result.student_name, "Excel氏名");
  assert.equal(result.homeroom_teacher, "金子");
});
