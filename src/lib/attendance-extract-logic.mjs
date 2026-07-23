export const validAttendanceEventTypes = new Set(["absence", "late", "reschedule_request", "other"]);

export function normalizeAttendanceText(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");
}

export function attendanceEventType(value) {
  return validAttendanceEventTypes.has(value) ? value : "other";
}

export function fallbackAttendanceReason(value) {
  if (value === "late") return "遅刻連絡";
  if (value === "reschedule_request") return "振替希望";
  if (value === "other") return "連絡";
  return "欠席連絡";
}

function addOneDay(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

export function expandAttendanceDates(start, end) {
  if (!isIsoDate(start)) return [];
  if (!isIsoDate(end) || end < start) return [start];
  const dates = [];
  let current = start;
  while (current <= end && dates.length < 31) {
    dates.push(current);
    current = addOneDay(current);
  }
  return dates;
}

export function normalizeAttendanceItems(ai) {
  const rawItems = Array.isArray(ai?.items) && ai.items.length > 0 ? ai.items : [{
    event_type: ai?.event_type,
    event_date: ai?.event_date,
    date_start: ai?.date_start,
    date_end: ai?.date_end,
    subject: ai?.subject,
    class_name: ai?.class_name,
    summary: ai?.summary,
    reason: ai?.reason,
  }];
  const rows = [];
  for (const item of rawItems) {
    const type = attendanceEventType(item.event_type ?? ai?.event_type);
    const dates = expandAttendanceDates(item.date_start ?? item.event_date ?? ai?.date_start ?? ai?.event_date, item.date_end ?? ai?.date_end);
    const targetDates = dates.length > 0 ? dates : [null];
    for (const date of targetDates) {
      rows.push({
        event_type: type,
        event_date: date,
        suggested_subject: item.subject ?? ai?.subject ?? null,
        suggested_class_name: item.class_name ?? ai?.class_name ?? null,
        ai_summary: item.summary ?? ai?.summary ?? item.reason ?? ai?.reason ?? fallbackAttendanceReason(type),
      });
    }
  }
  const seen = new Set();
  return rows.filter((row) => {
    const key = [row.event_type, row.event_date ?? "", normalizeAttendanceText(row.suggested_subject), normalizeAttendanceText(row.suggested_class_name), normalizeAttendanceText(row.ai_summary)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

