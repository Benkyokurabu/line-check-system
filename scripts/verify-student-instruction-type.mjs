import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[match[1]] = value;
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const rows = [];
for (let from = 0; ; from += 1000) {
  const result = await supabase
    .from("student_roster")
    .select("student_number,grade,instruction_type")
    .range(from, from + 999);
  if (result.error) throw result.error;
  rows.push(...(result.data ?? []));
  if (!result.data || result.data.length < 1000) break;
}

const byGrade = {};
const byInstructionType = {};
for (const row of rows) {
  const grade = row.grade || "未設定";
  const instructionType = row.instruction_type || "未設定";
  byGrade[grade] = (byGrade[grade] ?? 0) + 1;
  byInstructionType[instructionType] = (byInstructionType[instructionType] ?? 0) + 1;
}
const highSchoolStudents = rows.filter((row) => /^高[123]$/.test(row.grade ?? ""));

console.log(JSON.stringify({
  ok: true,
  students: rows.length,
  by_grade: Object.fromEntries(Object.entries(byGrade).sort(([a], [b]) => a.localeCompare(b, "ja"))),
  by_instruction_type: byInstructionType,
  high_school_students: highSchoolStudents.length,
  high_school_grades: highSchoolStudents.reduce((counts, row) => {
    counts[row.grade] = (counts[row.grade] ?? 0) + 1;
    return counts;
  }, {}),
}, null, 2));
