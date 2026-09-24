function normalized(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

/**
 * Automatically choose a lesson only when the choice is unambiguous.
 * A subject/class hint must identify exactly one enrolled lesson. Without a
 * hint, the sole enrolled lesson may be selected; two or more stay unselected.
 */
export function recommendedAttendanceLesson(lessons, subject, className) {
  const enrolled = (lessons ?? []).filter((lesson) => Boolean(lesson?.enrolled));
  const subjectHint = normalized(subject);
  const classHint = normalized(className);
  if (subjectHint || classHint) {
    const matches = enrolled.filter((lesson) => {
      const label = normalized(lesson?.label);
      return (!subjectHint || label.includes(subjectHint)) && (!classHint || label.includes(classHint));
    });
    return matches.length === 1 ? matches[0] : null;
  }
  return enrolled.length === 1 ? enrolled[0] : null;
}
