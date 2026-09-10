export const MAX_ATTENDANCE_RANGE_DAYS = 93;

export function attendanceRangeDates(start, end) {
  const parse = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  };
  const first = parse(start);
  const last = parse(end);
  if (!first || !last) throw new Error("開始日と終了日を正しい日付で入力してください。");
  if (last < first) throw new Error("終了日は開始日以降にしてください。");
  const count = (last - first) / 86400000 + 1;
  if (count > MAX_ATTENDANCE_RANGE_DAYS) throw new Error(`期間は${MAX_ATTENDANCE_RANGE_DAYS}日以内で指定してください。`);
  return Array.from({ length: count }, (_, i) => new Date(first.getTime() + i * 86400000).toISOString().slice(0, 10));
}
