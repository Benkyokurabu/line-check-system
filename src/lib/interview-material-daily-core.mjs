import { createHash } from 'node:crypto';
import { sameMaterialAppointment } from './interview-material-batch.mjs';
export class DailyMaterialError extends Error {}

export function tokyoMaterialNow(now = new Date()) {
  const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}
export function futureMaterialAppointment(row, now = new Date()) {
  const local = tokyoMaterialNow(now);
  return row.source === 'notion-bensuke' && Boolean(row.number && row.editedAt && row.teacherId)
    && (row.date > local.date || row.date === local.date && row.start > local.time);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .filter(([, item]) => item !== undefined).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function dailyMaterialSourceHash(appointment, payload, context) {
  const originals = { ...context }; delete originals.capturedAt;
  originals.summary = { sourceHash: context.summary?.sourceHash ?? '' };
  return createHash('sha256').update(JSON.stringify(canonical({ appointment, payload, context: originals }))).digest('hex');
}
export function verifiedDailyAppointment(expected, current, now = new Date()) {
  if (!current.some(row => sameMaterialAppointment(expected, row)) || !futureMaterialAppointment(expected, now))
    throw new DailyMaterialError('面談予定が変更・取消されたか、面談時刻を過ぎました。以前の資料は残しています。');
  return expected;
}
