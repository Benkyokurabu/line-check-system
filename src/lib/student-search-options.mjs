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

export function buildStudentSearchOptions(rows, identityAliases = []) {
  const byNumber = new Map((rows ?? []).map(row => [row.student_number, row]));
  const mergedByNumber = new Map();
  const superseded = new Set();
  for (const alias of identityAliases) {
    if (alias.verified !== true || alias.from === alias.to) continue;
    const previous = byNumber.get(alias.from);
    const current = byNumber.get(alias.to);
    // Numeric IDs are reconciled only through an explicitly verified mapping.
    // A same-name match alone must never merge two real students.
    if (!previous || !current || groupKey(previous) !== groupKey(current)) continue;
    if (!isNotionTemporaryNumber(previous.student_number) && !String(previous.source_file ?? "").startsWith("Notion")) continue;
    if (isNotionTemporaryNumber(current.student_number) || String(current.source_file ?? "").startsWith("Notion")) continue;
    if (!mergedByNumber.has(alias.to)) mergedByNumber.set(alias.to, []);
    mergedByNumber.get(alias.to).push(previous);
    superseded.add(alias.from);
  }
  const groups = new Map();
  for (const row of rows ?? []) {
    if (superseded.has(row.student_number)) continue;
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
        merged_record_count: temporary.length + (mergedByNumber.get(official[0].student_number)?.length ?? 0),
        merged_student_numbers: [...temporary, ...(mergedByNumber.get(official[0].student_number) ?? [])].map((row) => row.student_number),
        notion_page_ids: [...temporary, ...(mergedByNumber.get(official[0].student_number) ?? [])].filter(row => isNotionTemporaryNumber(row.student_number)).map((row) => row.student_number.slice("notion:".length)).filter(Boolean),
      });
      continue;
    }
    for (const row of group) {
      options.push({
        ...row,
        record_origin: isNotionTemporaryNumber(row.student_number) ? "notion_only" : "official_roster",
        merged_record_count: mergedByNumber.get(row.student_number)?.length ?? 0,
        merged_student_numbers: (mergedByNumber.get(row.student_number) ?? []).map(previous => previous.student_number),
        notion_page_ids: (mergedByNumber.get(row.student_number) ?? []).filter(previous => isNotionTemporaryNumber(previous.student_number)).map(previous => previous.student_number.slice("notion:".length)),
      });
    }
  }
  return options;
}

/** @param {string | null} protectedStudentNumber */
export function canonicalStudentSuggestions(suggestions, options, protectedStudentNumber = null) {
  const byNumber = new Map();
  for (const option of options) {
    const numbers = [option.student_number, ...(option.merged_student_numbers ?? [])];
    // Keep a human's existing selection intact when reviewing an older record.
    const protectedStudent = numbers.includes(protectedStudentNumber)
      ? suggestions.find(student => student.student_number === protectedStudentNumber) : null;
    for (const number of numbers) byNumber.set(number, protectedStudent ?? option);
  }
  const result = new Map();
  for (const suggestion of suggestions) {
    const student = byNumber.get(suggestion.student_number) ?? suggestion;
    const existing = result.get(student.student_number);
    if (!existing || suggestion.score > existing.score) {
      result.set(student.student_number, { ...student, score: suggestion.score, reason: suggestion.reason });
    }
  }
  return [...result.values()];
}
