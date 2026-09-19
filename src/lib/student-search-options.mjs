import { normalizeStudentName } from "./student-linking.ts";

function normalized(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

function isNotionTemporaryNumber(value) {
  return String(value ?? "").startsWith("notion:");
}

function groupKey(student) {
  return [normalizeStudentName(student.student_name), normalized(student.grade), normalized(student.campus)].join("|");
}

export function buildStudentSearchOptions(rows) {
  const groups = new Map();
  for (const row of rows ?? []) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const options = [];
  for (const group of groups.values()) {
    const official = group.filter((row) => !isNotionTemporaryNumber(row.student_number));
    const temporary = group.filter((row) => isNotionTemporaryNumber(row.student_number));
    if (official.length === 1 && temporary.length > 0 && official.length + temporary.length === group.length) {
      options.push({
        ...official[0],
        record_origin: "official_roster",
        merged_record_count: temporary.length,
        merged_student_numbers: temporary.map((row) => row.student_number),
        notion_page_ids: temporary.map((row) => row.student_number.slice("notion:".length)).filter(Boolean),
      });
      continue;
    }
    for (const row of group) {
      options.push({
        ...row,
        record_origin: isNotionTemporaryNumber(row.student_number) ? "notion_only" : "official_roster",
        merged_record_count: 0,
        merged_student_numbers: [],
        notion_page_ids: [],
      });
    }
  }
  return options;
}
