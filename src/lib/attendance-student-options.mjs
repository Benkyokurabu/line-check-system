import { normalizeStudentName } from "./student-linking.ts";

export function organizeStudentSuggestions(suggestions, confirmedNumbers, selectedNumbers, requiresSelection, message) {
  const confirmed = [...new Set(confirmedNumbers)];
  const selected = [...new Set(selectedNumbers.filter(Boolean))];
  const text = normalizeStudentName(message);
  const conflictingName = suggestions.some(student => !confirmed.includes(student.student_number)
    && normalizeStudentName(student.student_name).length > 1
    && text.includes(normalizeStudentName(student.student_name)));
  const canCollapse = confirmed.length === 1 && !requiresSelection && !conflictingName
    && selected.length === 1 && selected[0] === confirmed[0]
    && suggestions.some(student => student.student_number === confirmed[0]);
  return {
    primary: canCollapse ? suggestions.filter(student => student.student_number === confirmed[0]) : suggestions,
    other: canCollapse ? suggestions.filter(student => student.student_number !== confirmed[0]) : [],
  };
}
