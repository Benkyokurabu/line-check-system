import "server-only";

import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import {
  fileManifest,
  listRosterExcelFiles,
  mergeNotionStudentWithExistingRoster,
  resolveRosterExcelRoot,
} from "@/lib/roster-import-logic.mjs";
import { normalizeStudentName } from "@/lib/student-linking";
import { notionRequest } from "@/lib/notion";
import type { createSupabaseAdminClient } from "@/lib/supabase";

type SupabaseClient = ReturnType<typeof createSupabaseAdminClient>;



type NotionPropertyValue = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  number?: number | null;
  select?: { name?: string } | null;
  formula?: {
    type?: string;
    string?: string | null;
    number?: number | null;
    boolean?: boolean | null;
    date?: { start?: string | null } | null;
  };
};

type NotionPage = {
  id: string;
  properties?: Record<string, NotionPropertyValue>;
};

type NotionQueryResponse = {
  results?: NotionPage[];
  next_cursor?: string | null;
  has_more?: boolean;
};

export type SyncStudent = {
  student_number: string;
  student_name: string;
  notion_page_id?: string | null;
  grade?: string | null;
  campus?: string | null;
  homeroom_teacher?: string | null;
  school_name?: string | null;
  gender?: string | null;
  instruction_type?: string | null;
};

type ExcelStudentRow = {
  student_number: string;
  grade: string;
  student_name: string;
  homeroom_teacher: string;
  campus: string | null;
  school_name: string | null;
  gender: string | null;
  instruction_type?: string | null;
  source_file: string;
  updated_at: string;
};

type ExcelEnrollmentRow = {
  student_number: string;
  grade: string;
  subject: string;
  class_name: string;
  classroom: string | null;
  source_file: string;
  updated_at: string;
};

const CLASS_COLUMNS = [
  { subject: "数学", classroomIndex: 6, classIndex: 7 },
  { subject: "英語", classroomIndex: 9, classIndex: 10 },
  { subject: "国語", classroomIndex: 12, classIndex: 13 },
];

function gradeFromFileName(fileName: string) {
  const normalized = fileName.normalize("NFKC");
  const match = normalized.match(/([小中])\s*([1-6])/);
  if (!match) return null;
  return `${match[1]}${match[2]}`;
}

function cellText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCampus(value: unknown) {
  const text = cellText(value);
  if (text === "南") return "南教室";
  if (text === "本") return "本校";
  return text || null;
}

function readRosterExcelRowsForSync(files: string[], root = process.cwd(), threshold = currentStudentNumberThreshold()) {
  const rosterRoot = resolveRosterExcelRoot(root);
  const rows: ExcelStudentRow[] = [];
  const enrollments: ExcelEnrollmentRow[] = [];
  const timestamp = new Date().toISOString();

  for (const file of files) {
    const grade = gradeFromFileName(file);
    if (!grade) continue;

    const buffer = fs.readFileSync(path.join(rosterRoot, file));
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets["クラス一覧表"] ?? workbook.Sheets[workbook.SheetNames[0]];
    const records = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });

    for (const record of records.slice(2)) {
      const studentNumber = cellText(record[1]);
      const studentName = cellText(record[2]);
      const gender = cellText(record[3]) || null;
      const campus = normalizeCampus(record[0]);
      const schoolName = cellText(record[4]) || null;
      const teacher = cellText(record[5]) || "未設定";

      if (!studentNumber || !studentName) continue;
      if (!/^\d+$/.test(studentNumber)) continue;
      if (!isTargetStudentNumber(studentNumber, threshold)) continue;

      rows.push({
        student_number: studentNumber,
        grade,
        student_name: studentName,
        homeroom_teacher: teacher,
        campus,
        school_name: schoolName,
        gender,
        source_file: file,
        updated_at: timestamp,
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
          updated_at: timestamp,
        });
      }
    }
  }

  return { rows, enrollments };
}
type AppStudentRow = ExcelStudentRow;
type AppEnrollmentRow = ExcelEnrollmentRow;

export type RosterSyncCandidate = {
  student_number: string;
  kind: "add" | "update" | "class_update" | "name_variant" | "matched" | "notion_only" | "excel_only" | "app_only";
  severity: "apply" | "review" | "info";
  selected_by_default: boolean;
  can_apply: boolean;
  notion: Partial<SyncStudent> | null;
  excel: (Partial<ExcelStudentRow> & { classes?: string[] }) | null;
  app: (Partial<AppStudentRow> & { classes?: string[] }) | null;
  changes: string[];
};

export type RosterSyncPreview = {
  ok: true;
  generated_at: string;
  target: { student_number_min_exclusive: number };
  notion: { data_source_id: string; students: number; skipped: number };
  excel: { files: ReturnType<typeof fileManifest>; students: number; class_enrollments: number; source: "files" | "database" };
  app: { students: number; class_enrollments: number };
  counts: Record<RosterSyncCandidate["kind"], number>;
  candidates: RosterSyncCandidate[];
};

const DEFAULT_STUDENT_DATA_SOURCE_ID = "19ef0120-80a7-80b7-9f23-000b21e0a53b";
const SYNC_STUDENT_STATUSES = ["在塾", "見学中"] as const;
const PLACEHOLDER_STUDENT_NUMBERS = new Set(["2020000"]);

function notionStudentDataSourceId() {
  return process.env.NOTION_STUDENT_DATA_SOURCE_ID?.trim() || DEFAULT_STUDENT_DATA_SOURCE_ID;
}

function textFromProperty(property: NotionPropertyValue | undefined) {
  if (!property) return "";
  if (property.type === "title") return property.title?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
  if (property.type === "rich_text") return property.rich_text?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
  if (property.type === "number") return property.number == null ? "" : String(property.number);
  if (property.type === "select") return property.select?.name?.trim() ?? "";
  if (property.type === "formula") {
    if (property.formula?.type === "string") return property.formula.string?.trim() ?? "";
    if (property.formula?.type === "number") return property.formula.number == null ? "" : String(property.formula.number);
    if (property.formula?.type === "boolean") return property.formula.boolean == null ? "" : String(property.formula.boolean);
    if (property.formula?.type === "date") return property.formula.date?.start?.trim() ?? "";
  }
  return "";
}

function firstProperty(properties: Record<string, NotionPropertyValue>, names: string[]) {
  for (const name of names) {
    const value = textFromProperty(properties[name]);
    if (value) return value;
  }
  return "";
}

function currentStudentNumberThreshold(date = new Date()) {
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", month: "numeric" }).format(date));
  return month >= 3 ? 2019000 : 2018000;
}

function isTargetStudentNumber(value: string, threshold = currentStudentNumberThreshold()) {
  if (value.startsWith("notion:")) return true;
  const number = Number(normalizeStudentNumber(value));
  return Number.isFinite(number) && number > threshold;
}
function normalizeStudentNumber(value: string) {
  return value.normalize("NFKC").replace(/[^\d]/g, "");
}
function notionStudentNumber(pageId: string, rawStudentNumber: string, status: string) {
  if (status !== "在塾" && (!rawStudentNumber || PLACEHOLDER_STUDENT_NUMBERS.has(rawStudentNumber))) {
    return `notion:${pageId.replace(/-/g, "")}`;
  }
  return rawStudentNumber;
}


function normalizeName(value: string | null | undefined) {
  return normalizeStudentName(value);
}
function classKeys(rows: Array<Pick<ExcelEnrollmentRow, "subject" | "class_name" | "classroom">>) {
  return rows
    .map((row) => `${row.subject}:${row.class_name}:${row.classroom ?? ""}`)
    .sort((a, b) => a.localeCompare(b, "ja"));
}

function classLabels(rows: Array<Pick<ExcelEnrollmentRow, "subject" | "class_name" | "classroom">>) {
  return rows
    .map((row) => `${row.subject} ${row.class_name}${row.classroom ? ` (${row.classroom}教室)` : ""}`)
    .sort((a, b) => a.localeCompare(b, "ja"));
}

async function fetchNotionStudents(threshold = currentStudentNumberThreshold()) {
  const dataSourceId = notionStudentDataSourceId();
  const students: SyncStudent[] = [];
  let skipped = 0;
  let cursor: string | undefined;

  do {
    const body = await notionRequest(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        filter: {
          or: SYNC_STUDENT_STATUSES.map((status) => ({
            property: "状態",
            select: { equals: status },
          })),
        },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    }) as NotionQueryResponse;

    for (const page of body.results ?? []) {
      const properties = page.properties ?? {};
      const rawStudentNumber = normalizeStudentNumber(firstProperty(properties, ["学籍番号", "生徒番号", "番号"]));
      const status = firstProperty(properties, ["状態"]);
      const studentNumber = notionStudentNumber(page.id, rawStudentNumber, status);
      const studentName = firstProperty(properties, ["生徒氏名", "名前", "氏名"]);
      if (!studentNumber || !studentName) {
        skipped += 1;
        continue;
      }
      if (!isTargetStudentNumber(studentNumber, threshold)) continue;
      students.push({
        student_number: studentNumber,
        student_name: studentName,
        notion_page_id: page.id,
        grade: firstProperty(properties, ["学年"]) || null,
        campus: firstProperty(properties, ["所属"]) || null,
        homeroom_teacher: firstProperty(properties, ["担任"]) || null,
        school_name: firstProperty(properties, ["中学校", "小学校"]) || null,
        gender: firstProperty(properties, ["性別"]) || null,
        instruction_type: firstProperty(properties, ["授業形態", "指導形態", "受講形態"]) || null,
      });
    }

    cursor = body.has_more && body.next_cursor ? body.next_cursor : undefined;
  } while (cursor);

  return {
    dataSourceId,
    students: [...new Map(students.map((student) => [student.student_number, student])).values()],
    skipped,
  };
}

function targetRosterRow(excel: ExcelStudentRow | undefined) {
  if (!excel) return null;
  return {
    ...excel,
    student_name: excel.student_name,
    updated_at: new Date().toISOString(),
  };
}
function targetRosterRowFromNotion(notion: SyncStudent | undefined) {
  if (!notion) return null;
  return {
    student_number: notion.student_number,
    grade: notion.grade || "未設定",
    student_name: notion.student_name,
    homeroom_teacher: notion.homeroom_teacher || "未設定",
    campus: notion.campus || null,
    school_name: notion.school_name || null,
    gender: notion.gender || null,
    instruction_type: notion.instruction_type || null,
    source_file: "Notion生徒情報DB",
    updated_at: new Date().toISOString(),
  } satisfies ExcelStudentRow;
}

async function readAppRows(supabase: SupabaseClient, threshold = currentStudentNumberThreshold()) {
  const [studentsResult, enrollmentsResult] = await Promise.all([
    supabase.from("student_roster").select("student_number,grade,student_name,homeroom_teacher,campus,school_name,gender,instruction_type,source_file,updated_at"),
    supabase.from("student_class_enrollments").select("student_number,grade,subject,class_name,classroom,source_file,updated_at"),
  ]);
  if (studentsResult.error) throw new Error(studentsResult.error.message);
  if (enrollmentsResult.error) throw new Error(enrollmentsResult.error.message);
  const students = ((studentsResult.data ?? []) as AppStudentRow[]).filter((row) => isTargetStudentNumber(row.student_number, threshold));
  const targetNumbers = new Set(students.map((row) => row.student_number));
  const enrollments = ((enrollmentsResult.data ?? []) as AppEnrollmentRow[]).filter((row) => targetNumbers.has(row.student_number));
  return { students, enrollments };
}

function importedRosterFromAppRows(app: { students: AppStudentRow[]; enrollments: AppEnrollmentRow[] }) {
  return {
    rows: app.students.map((row) => ({ ...row })),
    enrollments: app.enrollments.map((row) => ({ ...row })),
  };
}

function mapByStudent<T extends { student_number: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    if (!map.has(row.student_number)) map.set(row.student_number, []);
    map.get(row.student_number)!.push(row);
  }
  return map;
}

function summarizeRow(row: Partial<ExcelStudentRow> | null, classes: string[] = []) {
  if (!row) return null;
  return {
    student_number: row.student_number,
    student_name: row.student_name,
    grade: row.grade,
    campus: row.campus,
    homeroom_teacher: row.homeroom_teacher,
    school_name: row.school_name,
    instruction_type: row.instruction_type,
    source_file: row.source_file,
    classes,
  };
}

function buildChangeList(target: ExcelStudentRow, app: AppStudentRow | undefined) {
  if (!app) return ["アプリ側へ新規追加"];
  const changes: string[] = [];
  const fields: Array<[keyof ExcelStudentRow, string]> = [
    ["student_name", "氏名"],
    ["grade", "学年"],
    ["campus", "所属"],
    ["homeroom_teacher", "担任"],
    ["school_name", "学校"],
    ["gender", "性別"],
    ["instruction_type", "授業形態"],
  ];
  for (const [key, label] of fields) {
    const before = app[key] ?? "";
    const after = target[key] ?? "";
    if (before !== after) changes.push(`${label}: ${before || "未設定"} -> ${after || "未設定"}`);
  }
  return changes;
}

export async function buildRosterSyncPreview({ supabase, root = process.cwd() }: { supabase: SupabaseClient; root?: string }): Promise<RosterSyncPreview> {
  const threshold = currentStudentNumberThreshold();
  const [notionResult, app] = await Promise.all([
    fetchNotionStudents(threshold),
    readAppRows(supabase, threshold),
  ]);
  const files = listRosterExcelFiles(root);
  const manifest = fileManifest(files, root) as ReturnType<typeof fileManifest>;
  const excelSource: "files" | "database" = files.length > 0 ? "files" : "database";
  const excel = files.length > 0 ? readRosterExcelRowsForSync(files, root, threshold) : importedRosterFromAppRows(app);
  const excelRows = [...new Map(excel.rows.map((row) => [row.student_number, row])).values()];
  const excelEnrollments = [
    ...new Map(excel.enrollments.map((row) => [`${row.student_number}:${row.subject}:${row.class_name}`, row])).values(),
  ];

  const notionByNumber = new Map(notionResult.students.map((row) => [row.student_number, row]));
  const excelByNumber = new Map(excelRows.map((row) => [row.student_number, row]));
  const appByNumber = new Map(app.students.map((row) => [row.student_number, row]));
  const excelClasses = mapByStudent(excelEnrollments);
  const appClasses = mapByStudent(app.enrollments);
  const allNumbers = [...new Set([...notionByNumber.keys(), ...excelByNumber.keys(), ...appByNumber.keys()])].sort();
  const candidates: RosterSyncCandidate[] = [];

  for (const studentNumber of allNumbers) {
    const notion = notionByNumber.get(studentNumber);
    const excelRow = excelByNumber.get(studentNumber);
    const appRow = appByNumber.get(studentNumber);
    const target = targetRosterRow(excelRow);
    const excelClassRows = excelClasses.get(studentNumber) ?? [];
    const appClassRows = appClasses.get(studentNumber) ?? [];
    const classChanged = classKeys(excelClassRows).join("|") !== classKeys(appClassRows).join("|");
    const nameVariantChange = notion && excelRow && normalizeName(notion.student_name) !== normalizeName(excelRow.student_name)
      ? `氏名表記差分: Notion「${notion.student_name}」 / Excel「${excelRow.student_name}」`
      : null;

    if (!target) {
      candidates.push({
        student_number: studentNumber,
        kind: notion ? "notion_only" : "app_only",
        severity: notion ? "apply" : "review",
        selected_by_default: Boolean(notion && !appRow),
        can_apply: Boolean(notion),
        notion: notion ?? null,
        excel: null,
        app: summarizeRow(appRow ?? null, classLabels(appClassRows)),
        changes: [notion ? "Notionにはありますが、クラス一覧Excelにありません。Notion情報でアプリ側名簿へ登録できます" : "アプリ側にはありますが、Notion/Excelにありません"],
      });
      continue;
    }

    if (!notion) {
      candidates.push({
        student_number: studentNumber,
        kind: "excel_only",
        severity: "review",
        selected_by_default: false,
        can_apply: true,
        notion: null,
        excel: summarizeRow(excelRow ?? null, classLabels(excelClassRows)),
        app: summarizeRow(appRow ?? null, classLabels(appClassRows)),
        changes: ["クラス一覧Excelにはありますが、Notion生徒情報にありません"],
      });
      continue;
    }

    const fieldChanges = buildChangeList(target, appRow);
    const displayChanges = [...fieldChanges, ...(nameVariantChange ? [nameVariantChange] : [])];
    if (!appRow) {
      candidates.push({
        student_number: studentNumber,
        kind: "add",
        severity: "apply",
        selected_by_default: true,
        can_apply: true,
        notion,
        excel: summarizeRow(excelRow ?? null, classLabels(excelClassRows)),
        app: null,
        changes: displayChanges,
      });
      continue;
    }

    if (fieldChanges.length > 0 || classChanged) {
      candidates.push({
        student_number: studentNumber,
        kind: fieldChanges.length > 0 ? "update" : "class_update",
        severity: "apply",
        selected_by_default: fieldChanges.length === 0 && classChanged,
        can_apply: true,
        notion,
        excel: summarizeRow(excelRow ?? null, classLabels(excelClassRows)),
        app: summarizeRow(appRow, classLabels(appClassRows)),
        changes: [...displayChanges, ...(classChanged ? ["クラス所属をExcelに合わせて更新"] : [])],
      });
      continue;
    }

    if (nameVariantChange) {
      candidates.push({
        student_number: studentNumber,
        kind: "name_variant",
        severity: "review",
        selected_by_default: false,
        can_apply: false,
        notion,
        excel: summarizeRow(excelRow ?? null, classLabels(excelClassRows)),
        app: summarizeRow(appRow, classLabels(appClassRows)),
        changes: [nameVariantChange],
      });
      continue;
    }

    candidates.push({
      student_number: studentNumber,
      kind: "matched",
      severity: "info",
      selected_by_default: false,
      can_apply: false,
      notion,
      excel: summarizeRow(excelRow ?? null, classLabels(excelClassRows)),
      app: summarizeRow(appRow, classLabels(appClassRows)),
      changes: ["Excel・Notion・アプリが学籍番号で一致しています"],
    });
  }

  const counts = {
    add: 0,
    update: 0,
    class_update: 0,
    name_variant: 0,
    matched: 0,
    notion_only: 0,
    excel_only: 0,
    app_only: 0,
  } satisfies Record<RosterSyncCandidate["kind"], number>;
  for (const candidate of candidates) counts[candidate.kind] += 1;

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    target: { student_number_min_exclusive: threshold },
    notion: {
      data_source_id: notionResult.dataSourceId,
      students: notionResult.students.length,
      skipped: notionResult.skipped,
    },
    excel: {
      files: manifest,
      students: excelRows.length,
      class_enrollments: excelEnrollments.length,
      source: excelSource,
    },
    app: {
      students: app.students.length,
      class_enrollments: app.enrollments.length,
    },
    counts,
    candidates,
  };
}

export async function syncActiveNotionStudents({ supabase }: { supabase: SupabaseClient }) {
  const threshold = currentStudentNumberThreshold();
  const notionResult = await fetchNotionStudents(threshold);
  const studentNumbers = notionResult.students.map((student) => student.student_number);
  if (studentNumbers.length === 0) {
    return { ok: true, active_students: 0, synced_students: 0 };
  }

  const { data: currentRows, error: currentError } = await supabase
    .from("student_roster")
    .select("student_number,grade,student_name,homeroom_teacher,campus,school_name,gender,instruction_type,source_file")
    .in("student_number", studentNumbers);
  if (currentError) throw new Error(currentError.message);

  const currentByNumber = new Map((currentRows ?? []).map((row) => [row.student_number as string, row]));
  const updatedAt = new Date().toISOString();
  const rows = notionResult.students.map((student) => mergeNotionStudentWithExistingRoster(
    student,
    currentByNumber.get(student.student_number),
    updatedAt,
  ));

  const { error: syncError } = await supabase
    .from("student_roster")
    .upsert(rows, { onConflict: "student_number" });
  if (syncError) throw new Error(syncError.message);

  return {
    ok: true,
    active_students: notionResult.students.length,
    synced_students: rows.length,
    synced_at: updatedAt,
  };
}

export async function syncSelectedRosterStudents({ supabase, root = process.cwd(), studentNumbers }: { supabase: SupabaseClient; root?: string; studentNumbers: string[] }) {
  const threshold = currentStudentNumberThreshold();
  const selected = [...new Set(studentNumbers.map(normalizeStudentNumber).filter((studentNumber) => studentNumber && isTargetStudentNumber(studentNumber, threshold)))];
  if (selected.length === 0) throw new Error(`反映対象の生徒が選択されていません。対象は学籍番号 ${threshold} より大きい生徒です`);

  const notionResult = await fetchNotionStudents(threshold);
  const notionByNumber = new Map(notionResult.students.map((row) => [row.student_number, row]));
  const files = listRosterExcelFiles(root);
  const excel = files.length > 0 ? readRosterExcelRowsForSync(files, root, threshold) : importedRosterFromAppRows(await readAppRows(supabase, threshold));
  const excelRows = [...new Map(excel.rows.map((row) => [row.student_number, row])).values()];
  const excelByNumber = new Map(excelRows.map((row) => [row.student_number, row]));
  const enrollmentsByNumber = mapByStudent(excel.enrollments as ExcelEnrollmentRow[]);

  const rosterRows = selected
    .map((studentNumber) => {
      const notion = notionByNumber.get(studentNumber);
      const row = targetRosterRow(excelByNumber.get(studentNumber)) ?? targetRosterRowFromNotion(notion);
      if (!row || !notion) return row;
      return {
        ...row,
        ...(row.homeroom_teacher === "未設定" && notion.homeroom_teacher
          ? { homeroom_teacher: notion.homeroom_teacher }
          : {}),
        ...(notion.instruction_type ? { instruction_type: notion.instruction_type } : {}),
      };
    })
    .filter((row): row is ExcelStudentRow => Boolean(row));
  if (rosterRows.length === 0) throw new Error("選択した生徒はクラス一覧Excel/Notion生徒情報に見つかりませんでした");

  const { error: rosterError } = await supabase
    .from("student_roster")
    .upsert(rosterRows, { onConflict: "student_number" });
  if (rosterError) throw new Error(rosterError.message);

  const selectedWithExcelRoster = rosterRows
    .map((row) => row.student_number)
    .filter((studentNumber) => excelByNumber.has(studentNumber));

  if (selectedWithExcelRoster.length > 0) {
    const deleteResult = await supabase
      .from("student_class_enrollments")
      .delete()
      .in("student_number", selectedWithExcelRoster);
    if (deleteResult?.error) throw new Error(deleteResult.error.message);
  }

  const enrollmentRows = selectedWithExcelRoster.flatMap((studentNumber) => enrollmentsByNumber.get(studentNumber) ?? []);
  if (enrollmentRows.length > 0) {
    const { error: enrollmentError } = await supabase
      .from("student_class_enrollments")
      .insert(enrollmentRows);
    if (enrollmentError) throw new Error(enrollmentError.message);
  }

  return {
    ok: true,
    requested: selected.length,
    synced_students: rosterRows.length,
    synced_class_enrollments: enrollmentRows.length,
    skipped: selected.length - rosterRows.length,
  };
}



