import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(path.resolve(".env.local"));
const sourceDir = path.resolve("【完成版】授業日誌システム");
const args = process.argv.slice(2);
const files = args.length > 0
  ? args.map((value) => path.resolve(value))
  : fs.readdirSync(sourceDir).filter((name) => /^schedule_\d{4}-\d{2}\.json$/.test(name)).map((name) => path.join(sourceDir, name));
const subjectNames = { arith: "算数", math: "数学", eng: "英語", jp: "国語", sci: "理科", soc: "社会" };
const gradeNames = { e4: "小4", e5: "小5", e6: "小6", j1: "中1", j2: "中2", j3: "中3" };
const campusNames = { hon: "本校", minami: "南教室" };
const rows = [];
for (const file of files) {
  for (const item of JSON.parse(fs.readFileSync(file, "utf8"))) {
    const key = [item.date, item.time ?? "", item.campus ?? "", item.groupKey ?? item.label, item.room ?? ""].join("|");
    rows.push({
      lesson_date: item.date,
      start_time: item.time || null,
      grade: gradeNames[item.grade] ?? item.grade ?? null,
      class_name: item.class || null,
      subject: subjectNames[item.subject] ?? item.subject ?? null,
      campus: campusNames[item.campus] ?? item.campus ?? null,
      classroom: item.room || null,
      teacher_name: item.teacher || null,
      label: item.displayTitle || item.label || "授業",
      source_key: key,
      source_file: path.basename(file),
      source_payload: item,
      updated_at: new Date().toISOString(),
    });
  }
}
const unique = [...new Map(rows.map((row) => [row.source_key, row])).values()];
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("Supabase environment variables are required");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
for (let index = 0; index < unique.length; index += 500) {
  const { error } = await supabase.from("lessons").upsert(unique.slice(index, index + 500), { onConflict: "source_key" });
  if (error) throw error;
}
console.log(JSON.stringify({ ok: true, files: files.map((file) => path.basename(file)), lessons: unique.length }, null, 2));
