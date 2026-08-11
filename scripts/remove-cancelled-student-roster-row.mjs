import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

async function main() {
  const [studentNumber, expectedName] = process.argv.slice(2);
  if (!studentNumber || !expectedName) throw new Error("Usage: node scripts/remove-cancelled-student-roster-row.mjs <student-number> <expected-name>");
  loadEnv(path.resolve(".env.local"));
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data: rosterRows, error: rosterError } = await client.from("student_roster").select("*").eq("student_number", studentNumber);
  if (rosterError) throw rosterError;
  if (rosterRows.length !== 1 || rosterRows[0].student_name.replace(/[\s　]/g, "") !== expectedName.replace(/[\s　]/g, "")) {
    throw new Error("The roster target did not match exactly.");
  }
  const dependencyTables = ["student_line_accounts", "student_line_links", "student_class_enrollments", "attendance_candidates", "attendance_candidate_items", "attendance_events", "student_interactions"];
  for (const table of dependencyTables) {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq("student_number", studentNumber);
    if (error) throw error;
    if (count) throw new Error(`Refusing to delete: ${table} still has ${count} related row(s).`);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backup = `student_roster.before_remove_cancelled_${stamp}.json`;
  fs.writeFileSync(backup, JSON.stringify(rosterRows, null, 2), "utf8");
  const { error: deleteError } = await client.from("student_roster").delete().eq("student_number", studentNumber);
  if (deleteError) throw deleteError;
  console.log(JSON.stringify({ deleted: 1, student_name: rosterRows[0].student_name, backup }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
