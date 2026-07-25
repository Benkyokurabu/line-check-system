import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const root = process.cwd();
const MANIFEST_KEY = "roster_excel_import_manifest";
const force = process.argv.includes("--force");
const CLASS_COLUMNS = [
  { subject: "数学", classroomIndex: 6, classIndex: 7 },
  { subject: "英語", classroomIndex: 9, classIndex: 10 },
  { subject: "国語", classroomIndex: 12, classIndex: 13 },
];

function loadEnvFile(fileName) {
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function gradeFromFileName(fileName) {
  const normalized = fileName.normalize("NFKC");
  const match = normalized.match(/([小中])\s*([1-6])/);
  if (!match) return null;
  return `${match[1]}${match[2]}`;
}

function cellText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCampus(value) {
  const text = cellText(value);
  if (text === "南") return "南教室";
  if (text === "本") return "本校";
  return text || null;
}

loadEnvFile(".env.local");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}

const files = fs
  .readdirSync(root)
  .filter((file) => file.includes("クラス一覧表") && file.endsWith(".xlsx"))
  .sort((a, b) => a.localeCompare(b, "ja"));

function fileManifest(fileNames) {
  return fileNames.map((file) => {
    const stat = fs.statSync(path.join(root, file));
    return {
      file,
      size: stat.size,
      mtime_ms: Math.trunc(stat.mtimeMs),
    };
  });
}

function sameManifest(current, previous) {
  if (!Array.isArray(previous) || current.length !== previous.length) return false;
  return current.every((file, index) => {
    const before = previous[index];
    return before?.file === file.file && before?.size === file.size && before?.mtime_ms === file.mtime_ms;
  });
}

if (files.length === 0) {
  console.error("No roster Excel files found.");
  process.exit(1);
}

const rows = [];
const enrollments = [];

for (const file of files) {
  const grade = gradeFromFileName(file);
  if (!grade) {
    console.warn(`Skipped ${file}: grade was not detected.`);
    continue;
  }

  const workbook = XLSX.readFile(path.join(root, file));
  const sheet = workbook.Sheets["クラス一覧表"] ?? workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });

  for (const record of records.slice(2)) {
    const studentNumber = cellText(record[1]);
    const studentName = cellText(record[2]);
    const gender = cellText(record[3]) || null;
    const campus = normalizeCampus(record[0]);
    const schoolName = cellText(record[4]) || null;
    const teacher = cellText(record[5]);

    if (!studentNumber || !studentName || !teacher) continue;
    if (!/^\d+$/.test(studentNumber)) continue;

    rows.push({
      student_number: studentNumber,
      grade,
      student_name: studentName,
      homeroom_teacher: teacher,
      campus,
      school_name: schoolName,
      gender,
      source_file: file,
      updated_at: new Date().toISOString(),
    });

    for (const column of CLASS_COLUMNS) {
      const className = cellText(record[column.classIndex]);
      if (!className) continue;
      enrollments.push({
        student_number: studentNumber,
        grade,
        subject: column.subject,
        class_name: className,
        classroom: cellText(record[column.classroomIndex]) || null,
        source_file: file,
        updated_at: new Date().toISOString(),
      });
    }
  }
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const currentManifest = fileManifest(files);
const { data: previousManifestRow, error: previousManifestError } = await supabase
  .from("app_settings")
  .select("value")
  .eq("key", MANIFEST_KEY)
  .maybeSingle();

if (previousManifestError && !["42P01", "PGRST205"].includes(previousManifestError.code)) {
  console.error(previousManifestError);
  process.exit(1);
}

if (!force && sameManifest(currentManifest, previousManifestRow?.value)) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: "Roster Excel files are unchanged since the last import.",
    files: currentManifest.map((item) => item.file),
  }, null, 2));
  process.exit(0);
}

const uniqueRows = [...new Map(rows.map((row) => [row.student_number, row])).values()];
const uniqueEnrollments = [
  ...new Map(
    enrollments.map((row) => [
      `${row.student_number}:${row.subject}:${row.class_name}`,
      row,
    ]),
  ).values(),
];

const { error } = await supabase
  .from("student_roster")
  .upsert(uniqueRows, { onConflict: "student_number" });

if (error) {
  console.error(error);
  process.exit(1);
}

const { error: deleteEnrollmentError } = await supabase
  .from("student_class_enrollments")
  .delete()
  .neq("student_number", "__never__");

if (deleteEnrollmentError) {
  console.error(deleteEnrollmentError);
  process.exit(1);
}

if (uniqueEnrollments.length > 0) {
  const { error: enrollmentError } = await supabase
    .from("student_class_enrollments")
    .insert(uniqueEnrollments);

  if (enrollmentError) {
    console.error(enrollmentError);
    process.exit(1);
  }
}

const { error: manifestError } = await supabase
  .from("app_settings")
  .upsert({
    key: MANIFEST_KEY,
    value: currentManifest,
    description: "Last imported roster Excel file names, sizes, and mtimes.",
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });

if (manifestError && !["42P01", "PGRST205"].includes(manifestError.code)) {
  console.error(manifestError);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  skipped: false,
  students: uniqueRows.length,
  class_enrollments: uniqueEnrollments.length,
  duplicate_roster_rows_skipped: rows.length - uniqueRows.length,
  files: currentManifest.map((item) => item.file),
}, null, 2));
