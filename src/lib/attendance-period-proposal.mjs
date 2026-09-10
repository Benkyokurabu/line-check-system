import { attendanceRangeDates } from "./attendance-date-range.mjs";

// Only untouched, uniform multi-day rows are safe to replace with a lesson proposal.
export function attendancePeriodProposal(items) {
  if (!items || items.length < 2) return null;
  const first = items[0];
  if (!["absence", "late"].includes(first.event_type)) return null;
  const uniform = ["event_type", "ai_summary", "suggested_subject", "suggested_class_name", "arrival_expected_time"];
  if (items.some((item) => item.status !== "pending" || item.lesson_id || item.note_internal || item.note_for_classroom || item.cross_campus_override || item.cross_campus_reason || uniform.some((key) => (item[key] || "") !== (first[key] || "")))) return null;
  if (new Set(items.map((item) => item.student_number).filter(Boolean)).size > 1) return null;
  const dates = [...new Set(items.map((item) => item.event_date))].sort();
  if (dates.some((date) => !date) || dates.length !== items.length) return null;
  try {
    const all = attendanceRangeDates(dates[0], dates.at(-1));
    if (all.length !== dates.length) return null;
  } catch { return null; }
  return { start: dates[0], end: dates.at(-1), eventType: first.event_type, reason: first.ai_summary || "", subject: first.suggested_subject || "", className: first.suggested_class_name || "", arrival: first.arrival_expected_time || "" };
}

export function lessonsForPeriodProposal(lessons, proposal) {
  const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/[\s　]/g, "");
  return lessons.filter((lesson) => lesson.lesson_date >= proposal.start && lesson.lesson_date <= proposal.end &&
    (!proposal.subject || normalize(lesson.subject) === normalize(proposal.subject)) &&
    (!proposal.className || normalize(lesson.class_name) === normalize(proposal.className)));
}
