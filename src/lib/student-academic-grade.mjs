/**
 * The first four digits encode the elementary-school entry cohort, not birth year.
 * Match the existing Notion formula: the teaching year advances on March 1 (JST).
 * Unknown/temporary numbers retain their source grade; never infer from a name.
 */
export function academicGrade(studentNumber, at = new Date()) {
  const number = String(studentNumber ?? "").trim();
  if (!/^\d{7}$/.test(number) || !Number.isFinite(at.getTime())) return null;
  const local = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const cohort = Number(number.slice(0, 4));
  const level = year - cohort + (local.getUTCMonth() >= 2 ? 1 : 0);
  if (cohort < 1900 || cohort > year || level <= 0) return null;
  if (level <= 6) return `小${level}`;
  if (level <= 9) return `中${level - 6}`;
  if (level <= 12) return `高${level - 9}`;
  return `約${level + 6}才`;
}

/** @template {{student_number?: unknown, grade?: unknown}} T
 * @param {T} student
 * @param {Date} [at]
 * @returns {T}
 */
export function withAcademicGrade(student, at = new Date()) {
  const grade = academicGrade(student.student_number, at);
  return grade === null ? student : { ...student, grade };
}

/** Refresh only current identity labels, never historical event snapshots. */
export function withContactAcademicGrades(contact, at = new Date()) {
  return {
    ...contact,
    registered_accounts: (contact.registered_accounts ?? []).map(student => withAcademicGrade(student, at)),
  };
}
