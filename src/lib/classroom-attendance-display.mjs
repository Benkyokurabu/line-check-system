export function normalizeClassroomEventType(sourceLabel) {
  if (sourceLabel === "遅刻") return "late";
  if (sourceLabel === "早退") return "early_leave";
  return "absence";
}

export function classroomEventTypeLabel(eventType, sourceLabel) {
  if (typeof sourceLabel === "string" && sourceLabel.trim()) return sourceLabel.trim();
  if (eventType === "late") return "遅刻";
  if (eventType === "early_leave") return "早退";
  return "欠席";
}
