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

function uniquePropertyNames(names) {
  return [...new Set(names.map((name) => name?.trim()).filter(Boolean))];
}

export function attendanceReasonPropertyNames(configuredName) {
  const legacyNames = new Set(["（旧）理由", "(旧)理由"]);
  const configured = configuredName?.trim();
  return uniquePropertyNames(["理由", "理由等", legacyNames.has(configured) ? null : configured, "連絡名"]);
}

export function attendanceTypePropertyNames(configuredName) {
  return uniquePropertyNames(["選択", configuredName, "種別", "区分"]);
}
