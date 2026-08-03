export function classroomLessonStartMinutes(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const normalized = String(value).normalize("NFKC");
  const match = normalized.match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  const rawHour = Number(match[1]);
  const minute = Number(match[2]);
  const hour = rawHour >= 1 && rawHour <= 8 ? rawHour + 12 : rawHour;
  return hour * 60 + minute;
}

export function pickClassroomLessonByEndBoundary(lessons, nowMinutes, durationMinutes = 90) {
  if (!Array.isArray(lessons) || lessons.length === 0) return null;
  const ordered = [...lessons].sort(
    (left, right) => classroomLessonStartMinutes(left.start_time) - classroomLessonStartMinutes(right.start_time),
  );
  const selected = ordered.find((lesson) => {
    const start = classroomLessonStartMinutes(lesson.start_time);
    if (!Number.isFinite(start)) return false;
    const switchAt = start + durationMinutes + 1;
    return nowMinutes < switchAt;
  });
  return selected ?? ordered.at(-1) ?? null;
}
