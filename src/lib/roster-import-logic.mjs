import fs from "node:fs";
import path from "node:path";
import * as XLSXNamespace from "xlsx";

const XLSX = "default" in XLSXNamespace ? XLSXNamespace.default : XLSXNamespace;

export const ROSTER_MANIFEST_KEY = "roster_excel_import_manifest";
export const CANONICAL_ROSTER_DIRECTORY = "01 ★クラス一覧表(2026)";

const CLASS_COLUMNS = [
  { subject: "数学", classroomIndex: 6, classIndex: 7 },
  { subject: "英語", classroomIndex: 9, classIndex: 10 },
  { subject: "国語", classroomIndex: 12, classIndex: 13 },
];

export function resolveRosterExcelRoot(root = process.cwd()) {
  const canonicalRoot = path.join(root, CANONICAL_ROSTER_DIRECTORY);
  if (fs.existsSync(canonicalRoot) && fs.statSync(canonicalRoot).isDirectory()) {
    return canonicalRoot;
  }
  return root;
}

export function listRosterExcelFiles(root = process.cwd()) {
  const rosterRoot = resolveRosterExcelRoot(root);
  return fs
    .readdirSync(rosterRoot)
    .filter((file) => file.includes("クラス一覧表") && file.endsWith(".xlsx"))
    .sort((a, b) => a.localeCompare(b, "ja"));
}

export function fileManifest(fileNames, root = process.cwd()) {
  const rosterRoot = resolveRosterExcelRoot(root);
  return fileNames.map((file) => {
    const stat = fs.statSync(path.join(rosterRoot, file));
    return {
      file,
      size: stat.size,
      mtime_ms: Math.trunc(stat.mtimeMs),
      mtime: stat.mtime.toISOString(),
    };
  });
}

export function sameManifest(current, previous) {
  if (!Array.isArray(previous) || current.length !== previous.length) return false;
  return current.every((file, index) => {
    const before = previous[index];
    return before?.file === file.file && before?.size === file.size && before?.mtime_ms === file.mtime_ms;
  });
}

export function changedManifestFiles(current, previous) {
  if (!Array.isArray(previous)) {
    return current.map((file) => ({ ...file, status: "initial" }));
  }
  const previousByFile = new Map(previous.map((file) => [file.file, file]));
  return current
    .filter((file) => {
      const before = previousByFile.get(file.file);
      return !before || before.size !== file.size || before.mtime_ms !== file.mtime_ms;
    })
    .map((file) => ({ ...file, status: previousByFile.has(file.file) ? "changed" : "new" }));
}

export async function getRosterImportPreview({ supabase, root = process.cwd() }) {
  const files = listRosterExcelFiles(root);
  const currentManifest = fileManifest(files, root);
  const { data: previousManifestRow, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", ROSTER_MANIFEST_KEY)
    .maybeSingle();

  if (error && !["42P01", "PGRST205"].includes(error.code)) throw error;

  const previousManifest = previousManifestRow?.value ?? null;
  const firstImport = !Array.isArray(previousManifest);
  const changedFiles = changedManifestFiles(currentManifest, previousManifest);
  return {
    ok: true,
    first_import: firstImport,
    changed: changedFiles.length > 0,
    files: currentManifest,
    changed_files: changedFiles,
    message: firstImport
      ? `初回取り込みです。フォルダ内のクラス一覧表 ${currentManifest.length}件を表示しています。`
      : changedFiles.length > 0
        ? `新しくなっていたクラス一覧表 ${changedFiles.length}件を取り込みます。`
        : "前回取り込み後に新しくなったクラス一覧表はありません。",
  };
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

export function readRosterExcelRows(files, root = process.cwd()) {
  const rosterRoot = resolveRosterExcelRoot(root);
  const rows = [];
  const enrollments = [];
  const skippedFiles = [];

  for (const file of files) {
    const grade = gradeFromFileName(file);
    if (!grade) {
      skippedFiles.push({ file, reason: "grade_not_detected" });
      continue;
    }

    const workbook = XLSX.readFile(path.join(rosterRoot, file));
    const sheet = workbook.Sheets["クラス一覧表"] ?? workbook.Sheets[workbook.SheetNames[0]];
    const records = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });

    for (const record of records.slice(2)) {
      const studentNumber = cellText(record[1]);
      const studentName = cellText(record[2]);
      const gender = cellText(record[3]) || null;
      const campus = normalizeCampus(record[0]);
      const schoolName = cellText(record[4]) || null;
      const teacher = cellText(record[5]) || "未設定";

      if (!studentNumber || !studentName) continue;
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

  return { rows, enrollments, skippedFiles };
}

export async function preserveExistingTeachers(supabase, rows) {
  const missingTeacherNumbers = rows
    .filter((row) => row.homeroom_teacher === "未設定")
    .map((row) => row.student_number);
  if (missingTeacherNumbers.length === 0) return rows;

  const { data, error } = await supabase
    .from("student_roster")
    .select("student_number,homeroom_teacher")
    .in("student_number", missingTeacherNumbers);
  if (error) throw error;

  const existingTeachers = new Map(
    (data ?? [])
      .filter((row) => row.homeroom_teacher && row.homeroom_teacher !== "未設定")
      .map((row) => [row.student_number, row.homeroom_teacher]),
  );
  return rows.map((row) => ({
    ...row,
    homeroom_teacher: existingTeachers.get(row.student_number) ?? row.homeroom_teacher,
  }));
}

export function mergeNotionStudentWithExistingRoster(student, current, updatedAt = new Date().toISOString()) {
  const preserveExcelFields = Boolean(current?.source_file?.includes("クラス一覧表"));
  return {
    student_number: student.student_number,
    student_name: preserveExcelFields ? current.student_name : student.student_name,
    grade: preserveExcelFields ? current.grade : student.grade || current?.grade || "未設定",
    homeroom_teacher: preserveExcelFields
      ? current.homeroom_teacher === "未設定"
        ? student.homeroom_teacher || current.homeroom_teacher
        : current.homeroom_teacher
      : student.homeroom_teacher || current?.homeroom_teacher || "未設定",
    campus: preserveExcelFields ? current.campus : student.campus || current?.campus || null,
    school_name: preserveExcelFields ? current.school_name : student.school_name || current?.school_name || null,
    gender: preserveExcelFields ? current.gender : student.gender || current?.gender || null,
    instruction_type: student.instruction_type || current?.instruction_type || null,
    source_file: current?.source_file || "Notion生徒情報DB",
    updated_at: updatedAt,
  };
}

export async function importRosterFromExcel({ supabase, root = process.cwd(), force = false }) {
  const preview = await getRosterImportPreview({ supabase, root });
  if (!force && !preview.changed) {
    return {
      ...preview,
      skipped: true,
      reason: "Roster Excel files are unchanged since the last import.",
    };
  }

  if (preview.files.length === 0) {
    throw new Error("No roster Excel files found.");
  }

  const { rows, enrollments, skippedFiles } = readRosterExcelRows(preview.files.map((file) => file.file), root);
  const uniqueRows = [...new Map(rows.map((row) => [row.student_number, row])).values()];
  const rosterRows = await preserveExistingTeachers(supabase, uniqueRows);
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
    .upsert(rosterRows, { onConflict: "student_number" });
  if (error) throw error;

  const { error: deleteEnrollmentError } = await supabase
    .from("student_class_enrollments")
    .delete()
    .neq("student_number", "__never__");
  if (deleteEnrollmentError) throw deleteEnrollmentError;

  if (uniqueEnrollments.length > 0) {
    const { error: enrollmentError } = await supabase
      .from("student_class_enrollments")
      .insert(uniqueEnrollments);
    if (enrollmentError) throw enrollmentError;
  }

  const { error: manifestError } = await supabase
    .from("app_settings")
    .upsert({
      key: ROSTER_MANIFEST_KEY,
      value: preview.files,
      description: "Last imported roster Excel file names, sizes, and mtimes.",
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
  if (manifestError && !["42P01", "PGRST205"].includes(manifestError.code)) throw manifestError;

  return {
    ...preview,
    skipped: false,
    students: rosterRows.length,
    class_enrollments: uniqueEnrollments.length,
    duplicate_roster_rows_skipped: rows.length - uniqueRows.length,
    skipped_files: skippedFiles,
  };
}
