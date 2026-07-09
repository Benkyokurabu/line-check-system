import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const root = process.cwd();
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

loadEnvFile(".env.local");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}

const files = fs
  .readdirSync(root)
  .filter((file) => file.includes("クラス一覧表") && file.endsWith(".xlsx"));

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
    const campus = cellText(record[4]) || null;
    const teacher = cellText(record[5]);

    if (!studentNumber || !studentName || !teacher) continue;
    if (!/^\d+$/.test(studentNumber)) continue;

    rows.push({
      student_number: studentNumber,
      grade,
      student_name: studentName,
      homeroom_teacher: teacher,
      campus,
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

console.log(`Imported ${uniqueRows.length} students and ${uniqueEnrollments.length} class enrollments. ${rows.length - uniqueRows.length} duplicate roster rows were skipped.`);
