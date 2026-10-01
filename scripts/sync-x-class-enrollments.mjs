import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { listRosterExcelFiles, readRosterExcelRows } from "../src/lib/roster-import-logic.mjs";

const apply = process.argv.includes("--apply");
const rootArgument = process.argv.find((value) => value.startsWith("--root="));
const rosterRoot = rootArgument ? rootArgument.slice("--root=".length) : process.cwd();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabaseの接続設定がありません");

const source = readRosterExcelRows(listRosterExcelFiles(rosterRoot), rosterRoot);
const targets = [...new Map(source.enrollments
  .filter((row) => row.class_name.normalize("NFKC") === "X")
  .map((row) => [`${row.student_number}:${row.subject}:X`, { ...row, class_name: "X" }])).values()];
if (targets.length === 0) throw new Error("クラス一覧表にXクラスの登録がありません");

const db = createClient(url, key);
const numbers = [...new Set(targets.map((row) => row.student_number))];
const [rosterResult, existingResult] = await Promise.all([
  db.from("student_roster").select("student_number").in("student_number", numbers),
  db.from("student_class_enrollments").select("student_number,grade,subject,class_name,classroom,source_file,updated_at").eq("class_name", "X"),
]);
if (rosterResult.error || existingResult.error) throw new Error(rosterResult.error?.message || existingResult.error?.message);
const known = new Set((rosterResult.data ?? []).map((row) => row.student_number));
const missingStudents = numbers.filter((number) => !known.has(number));
if (missingStudents.length > 0) throw new Error(`Xクラスの対象生徒が名簿に${missingStudents.length}人見つかりません。名簿を確認してください`);
const existing = existingResult.data ?? [];
const existingKeys = new Set(existing.map((row) => `${row.student_number}:${row.subject}:${row.class_name}`));
const inserts = targets.filter((row) => !existingKeys.has(`${row.student_number}:${row.subject}:${row.class_name}`));
console.log(JSON.stringify({ source_files: source.skippedFiles.length === 0 ? listRosterExcelFiles(rosterRoot).length : null,
  x_enrollments_in_excel: targets.length, already_registered: targets.length - inserts.length, to_insert: inserts.length,
  other_existing_x_rows_preserved: existing.length - (targets.length - inserts.length), apply }, null, 2));
if (apply) {
  const backupPath = path.join(os.tmpdir(), `bentan-x-enrollments-before-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ existing, intended: inserts }, null, 2));
  if (inserts.length > 0) {
    const { error } = await db.from("student_class_enrollments").insert(inserts);
    if (error) throw new Error(error.message);
  }
  const { count, error: verifyError } = await db.from("student_class_enrollments").select("id", { count: "exact", head: true }).eq("class_name", "X");
  if (verifyError) throw new Error(verifyError.message);
  console.log(JSON.stringify({ inserted: inserts.length, x_enrollments_after: count, backup: backupPath }, null, 2));
}
