export function validateCopyRange(from, to) {
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || to < from || Date.parse(to) - Date.parse(from) > 30 * 86400000) {
    throw Error('開始日と終了日を、31日以内の期間で選んでください。');
  }
  return {from, to};
}

export function nextWeekCopyRange(now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo'}).format(now);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (8 - (date.getUTCDay() || 7)));
  const from = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 5);
  return {from, to: date.toISOString().slice(0, 10)};
}

export function formatAvailabilityCopy(rows) {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .map((row, index) => {
      const number = index + 1;
      const mark = number <= 20 ? String.fromCodePoint(0x245f + number)
        : number <= 35 ? String.fromCodePoint(0x3250 + number - 20)
          : number <= 50 ? String.fromCodePoint(0x32b0 + number - 35) : `（${number}）`;
      const [, month, day] = row.date.split('-').map(Number);
      const weekday = '日月火水木金土'[new Date(`${row.date}T00:00:00Z`).getUTCDay()];
      return `${mark} ${month}月${day}日（${weekday}）${row.start}〜${row.end || '（終了時刻なし）'}`;
    }).join('\n');
}
