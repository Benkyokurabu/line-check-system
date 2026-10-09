import {InterviewError, normalizeTeacher} from './interview-core.mjs';
import {resolveAvailabilityTeacher} from './bensuke-availability-auto.mjs';
import {BENSUKE_SOURCE, bookingSchema, queryPages, scheduleValue, staffDirectory, teacherMatch} from './bensuke-booking.mjs';
import {validateCopyRange, formatAvailabilityCopy} from './availability-copy-core.mjs';

const sameId = (a, b) => String(a).replaceAll('-', '').toLowerCase() === String(b).replaceAll('-', '').toLowerCase();
const teacherNames = ['金城', '工藤', '鈴木', '髙山', '金子'];
const teacherKey = value => normalizeTeacher(value).replace(/(?:先生|さん)$/u, '');
const availabilityTags = ['本：予約可', '南：予約可'];
export async function copyTeacherOptions(request, actor) {
  const schema = await request(`/data_sources/${BENSUKE_SOURCE}`);
  const staff = await staffDirectory(request, schema);
  const directory = teacherNames.filter(name => staff.some(person => teacherKey(person.name) === name))
    .map(name => ({...teacherMatch(name, staff), name: `${name}先生`}));
  let defaultTeacherId = '';
  try {
    const name = resolveAvailabilityTeacher({...actor, candidates: directory.map(person => person.name)});
    defaultTeacherId = teacherMatch(name, directory).id;
  } catch { /* Office accounts can select a teacher without a personal Notion card. */ }
  return {schema, directory, defaultTeacherId, teachers: directory.map(({id, name}) => ({id, name}))};
}

export async function readAvailabilityCopy({request, from, to, teacherId, actor}) {
  try { validateCopyRange(from, to); } catch (error) { throw new InterviewError(error.message, 422); }
  const {schema, directory} = await copyTeacherOptions(request, actor);
  const teacher = directory.find(person => sameId(person.id, teacherId));
  if (!teacher) throw new InterviewError('担当の先生を選び直してください。', 422);
  const properties = bookingSchema(schema);
  // Copy the reservation-available cards as written in Bensuke. This is a list,
  // not a booking confirmation: other events and historical absences are irrelevant.
  let pages;
  try {
    pages = await queryPages(request, BENSUKE_SOURCE, {and: [
      {property: properties.teachers.id, relation: {contains: teacher.id}},
      {property: properties.date.id, date: {on_or_after: `${from}T00:00:00+09:00`}},
      {property: properties.date.id, date: {on_or_before: `${to}T23:59:59+09:00`}},
      {or: availabilityTags.map(tag => ({property: properties.tags.id, multi_select: {contains: tag}}))},
    ]});
  } catch (error) {
    if (error instanceof InterviewError && error.message.includes('Notionの全予定')) {
      throw new InterviewError('予約可の一覧を全件取得できませんでした。期間を短くして再取得してください。', 503);
    }
    throw error;
  }
  const rows = [], seen = new Set();
  let reviewCount = 0;
  for (const page of pages) {
    const value = scheduleValue(page, schema);
    if (!value.tags.some(tag => availabilityTags.includes(tag)) || !value.teachers.some(id => sameId(id, teacher.id))) continue;
    const start = Date.parse(value.date?.start ?? ''), end = value.date?.end ? Date.parse(value.date.end) : null;
    if (!value.date?.start?.includes('T') || !Number.isFinite(start) || end !== null && (!value.date.end.includes('T') || !Number.isFinite(end) || end <= start)) { reviewCount++; continue; }
    const startJst = new Date(start + 9 * 3600000).toISOString();
    const endJst = end === null ? null : new Date(end + 9 * 3600000).toISOString();
    const date = startJst.slice(0, 10);
    if (date < from || date > to) continue;
    if (endJst && endJst.slice(0, 10) !== date) { reviewCount++; continue; }
    const slot = {date, start: startJst.slice(11, 16), end: endJst?.slice(11, 16) ?? '', campus: value.campuses.join('、'), room: value.room};
    const unique = `${slot.date}|${slot.start}|${slot.end}`;
    if (seen.has(unique)) continue;
    seen.add(unique);
    rows.push({...slot, pageId: page.id});
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return {teacher: teacher.name, teacherId: teacher.id, from, to, rows, text: formatAvailabilityCopy(rows), checkedAt: new Date().toISOString(), reviewCount};
}
