import { isValidReservationDate } from './reservation-date.mjs';

export class InterviewError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}
export const defaults = {
  duration: 45, buffer: 15, start: '13:00',
  daytime: ['13:00', '14:00', '15:00', '16:00', '17:00'],
  evening: ['20:30', '21:30'], flexibleStart: '18:35', flexibleEnd: '20:05', step: 5,
};
export const normalizeTeacher = value => String(value ?? '').normalize('NFKC').replace(/\s/g, '').replaceAll('高山', '髙山');
export function minutes(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new InterviewError('時刻を確認してください。');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
export const clock = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export const overlaps = (a, b, c, d) => a < d && c < b;
export function lessonInterval(lesson) {
  const times = String(lesson.start_time).normalize('NFKC').match(/(\d{1,2}:[0-5]\d)\s*[～〜~\-–－]\s*(\d{1,2}:[0-5]\d)/);
  if (!times) throw new InterviewError('授業時間を読み取れません。授業スケジュールを確認してください。');
  const start = minutes(times[1].padStart(5, '0')), end = minutes(times[2].padStart(5, '0'));
  if (end <= start) throw new InterviewError('授業の終了時刻を確認してください。');
  return [start, end];
}
export function validateSettings(value) {
  if (!value || !Number.isInteger(value.duration) || value.duration < 10 || value.duration > 120
    || !Number.isInteger(value.buffer) || value.buffer < 0 || value.buffer > 60
    || !Number.isInteger(value.step) || value.step < 1 || value.step > 30
    || !Array.isArray(value.daytime) || !Array.isArray(value.evening)
    || value.daytime.length + value.evening.length > 30) throw new InterviewError('予約枠の設定を確認してください。');
  for (const t of [value.start, value.flexibleStart, value.flexibleEnd, ...value.daytime, ...value.evening]) minutes(t);
  if (minutes(value.flexibleEnd) - minutes(value.flexibleStart) < value.duration) throw new InterviewError('時間帯が面談時間より短くなっています。');
  if ([...value.daytime,...value.evening].some(t => minutes(t) + value.duration + value.buffer >= 1440)) throw new InterviewError('予約枠は同日中に終了させてください。');
  return value;
}
function text(value, max = 1000) {
  if (typeof value !== 'string' || value.length > max) throw new InterviewError('入力文字数・形式を確認してください。');
  return value.trim();
}
/** @returns {Record<string,string>} */
export function validateAppointment(input, settings = defaults) {
  const value = {};
  for (const key of ['studentId','teacher','date','start','campus','method','purpose','participants','channel','note','room']) {
    value[key] = text(input?.[key] ?? '', key === 'note' ? 3000 : 500);
  }
  if (!/^[0-9a-f-]{36}$/i.test(value.studentId) || !value.teacher || !isValidReservationDate(value.date)
    || !['本校','南教室'].includes(value.campus) || !['対面','Zoom','電話','ハイブリッド'].includes(value.method)
    || !['LINE','電話','口頭','職員入力'].includes(value.channel) || !value.purpose || !value.participants
    || (value.room && !/^(?:[1-9]|1[0-9])$/.test(value.room))) throw new InterviewError('生徒・担当・日時・校舎・方法・目的・参加者・受付方法を確認してください。');
  const start = minutes(value.start), end = start + settings.duration;
  if (end + settings.buffer >= 1440) throw new InterviewError('面談は同日中に終了させてください。');
  value.end = clock(end);
  value.busyStart = value.start;
  value.busyEnd = clock(end + settings.buffer);
  if (start >= minutes(settings.flexibleStart) && start < minutes(settings.flexibleEnd)) {
    if (end > minutes(settings.flexibleEnd) || (start - minutes(settings.flexibleStart)) % settings.step) throw new InterviewError('この時間帯の開始時刻・終了時刻を確認してください。');
    value.busyStart = settings.flexibleStart; value.busyEnd = settings.flexibleEnd;
  }
  return value;
}
/** @param {object} value @param {object[]} lessons @param {object[]} bookings @param {object[]} external */
export function conflicts(value, lessons, bookings, external = []) {
  const start = minutes(value.busyStart), end = minutes(value.busyEnd), reasons = [];
  for (const row of lessons.filter(r => r.lesson_date === value.date)) {
    const [a,b] = lessonInterval(row);
    if (!overlaps(start,end,a,b)) continue;
    if (!row.teacher_name) reasons.push('担当不明の授業があります');
    else if (normalizeTeacher(row.teacher_name) === normalizeTeacher(value.teacher)) reasons.push('担当講師の授業と重なります');
    if (value.room && row.campus === value.campus && row.classroom === value.room) reasons.push('教室の授業と重なります');
  }
  for (const row of bookings.filter(r => r.id !== value.id && !['cancelled','rejected'].includes(r.status))) {
    const other = row.data;
    if (other.date !== value.date || !overlaps(start,end,minutes(other.busyStart),minutes(other.busyEnd))) continue;
    if (normalizeTeacher(other.teacher) === normalizeTeacher(value.teacher)) reasons.push('担当講師の面談と重なります');
    if (other.studentId === value.studentId) reasons.push('同じ生徒の面談と重なります');
    if (value.room && other.room === value.room && other.campus === value.campus) reasons.push('教室の面談と重なります');
  }
  for(const row of external) {
    if(row.date === value.date && overlaps(start,end,minutes(row.start),minutes(row.end))
      && (row.teachers.some(t=>normalizeTeacher(t)===normalizeTeacher(value.teacher))
        || (value.room && row.campus===value.campus && row.room===value.room))) reasons.push('Notionの既存予定と重なります');
  }
  return [...new Set(reasons)];
}
/** @param {{date:string,teacher:string,campus:string,lessons:object[],bookings?:object[],external?:object[],settings?:typeof defaults}} input
 * @returns {Record<string,string>[]} */
export function generateSlots({date, teacher, campus, lessons, bookings = [], external = [], settings = defaults}) {
  if (!isValidReservationDate(date) || !teacher || !['本校','南教室'].includes(campus)) throw new InterviewError('日付・担当・校舎を選んでください。');
  validateSettings(settings);
  const dayLessons = lessons.filter(r => r.lesson_date === date);
  // A class-free day is not evidence that a teacher is working or the campus is open.
  if (!dayLessons.some(r => r.campus === campus && normalizeTeacher(r.teacher_name) === normalizeTeacher(teacher))) return [];
  const starts = [...settings.daytime, ...settings.evening];
  for(let t = minutes(settings.flexibleStart); t + settings.duration <= minutes(settings.flexibleEnd); t += settings.step) starts.push(clock(t));
  return [...new Set(starts)].sort().filter(t => minutes(t) >= minutes(settings.start)).map(start => {
    const data = validateAppointment({studentId:'00000000-0000-4000-8000-000000000000',teacher,date,start,campus,method:'対面',purpose:'面談',participants:'未設定',channel:'職員入力'},settings);
    return {...data, key:[date,normalizeTeacher(teacher),campus,start].join('|')};
  }).filter(data => !conflicts(data,dayLessons,bookings,external).length);
}
