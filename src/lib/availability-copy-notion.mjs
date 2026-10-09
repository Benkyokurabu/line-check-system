import {InterviewError} from './interview-core.mjs';
import {resolveAvailabilityTeacher} from './bensuke-availability-auto.mjs';
import {BENSUKE_SOURCE, bookingSchema, queryPages, scheduleValue, staffDirectory, teacherMatch} from './bensuke-booking.mjs';
import {bensukeAvailability} from './bensuke-reader.mjs';
import {validateCopyRange, formatAvailabilityCopy} from './availability-copy-core.mjs';

const sameId = (a, b) => String(a).replaceAll('-', '').toLowerCase() === String(b).replaceAll('-', '').toLowerCase();
export async function copyTeacherOptions(request, actor) {
  const schema = await request(`/data_sources/${BENSUKE_SOURCE}`);
  const directory = await staffDirectory(request, schema);
  let defaultTeacherId = '';
  try {
    const name = resolveAvailabilityTeacher({...actor, candidates: directory.map(person => person.name)});
    defaultTeacherId = teacherMatch(name, directory).id;
  } catch { /* Office accounts can select a teacher without a personal Notion card. */ }
  return {schema, directory, defaultTeacherId, teachers: directory.map(({id, name}) => ({id, name})).sort((a, b) => a.name.localeCompare(b.name, 'ja'))};
}

export async function readAvailabilityCopy({request, from, to, teacherId, actor}) {
  try { validateCopyRange(from, to); } catch (error) { throw new InterviewError(error.message, 422); }
  const {schema, directory} = await copyTeacherOptions(request, actor);
  const teacher = directory.find(person => sameId(person.id, teacherId));
  if (!teacher) throw new InterviewError('担当の先生を選び直してください。', 422);
  const properties = bookingSchema(schema);
  // Include older events: a multi-day absence may start before the selected week.
  const pages = await queryPages(request, BENSUKE_SOURCE, {and: [
    {property: properties.teachers.id, relation: {contains: teacher.id}},
    {property: properties.date.id, date: {on_or_before: `${to}T23:59:59+09:00`}},
  ]});
  const values = pages.map(page => {
    const value = scheduleValue(page, schema);
    const normalized = {...page, properties: {
      '内容': {multi_select: value.tags.map(name => ({name}))},
      '校舎': {multi_select: value.campuses.map(name => ({name}))},
      '教室': {select: value.room ? {name: value.room} : null},
      '日時': {date: value.date},
    }};
    return {page, value, slot: bensukeAvailability(normalized)};
  });
  const blocked = values.filter(({value}) => !(value.tags.length === 1 && ['本：予約可', '南：予約可'].includes(value.tags[0])));
  const rows = [], seen = new Set();
  let conflictCount = 0, reviewCount = 0;
  for (const {page, value, slot} of values) {
    if (!slot) continue;
    const instant = Date.parse(value.date?.start ?? '');
    if (!Number.isFinite(instant)) { reviewCount++; continue; }
    const date = new Date(instant + 9 * 3600000).toISOString().slice(0, 10);
    if (date < from || date > to) continue;
    if (!slot.usable || value.teachers.length !== 1) { reviewCount++; continue; }
    const start = Date.parse(`${slot.date}T${slot.start}:00+09:00`);
    const end = Date.parse(`${slot.date}T${slot.end || '23:59'}:00+09:00`);
    const conflict = blocked.some(({value: other}) => {
      if (!other.date?.start) return false;
      const timed = other.date.start.includes('T');
      const a = Date.parse(timed ? other.date.start : `${other.date.start}T00:00:00+09:00`);
      let b = other.date.end ? Date.parse(other.date.end.includes('T') ? other.date.end : `${other.date.end}T00:00:00+09:00`) + (other.date.end.includes('T') ? 0 : 86400000)
        : Date.parse(`${new Date(a + 9 * 3600000).toISOString().slice(0, 10)}T23:59:59+09:00`) + 1000;
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new InterviewError('重なる予定の日時を確認できません。Notionで確認してください。', 409);
      if (b <= a) b = Date.parse(`${new Date(a + 9 * 3600000).toISOString().slice(0, 10)}T23:59:59+09:00`) + 1000;
      return a < end && start < b;
    });
    if (conflict) { conflictCount++; continue; }
    const unique = `${slot.date}|${slot.start}|${slot.end}`;
    if (seen.has(unique)) continue;
    seen.add(unique);
    rows.push({...slot, pageId: page.id});
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return {teacher: teacher.name, teacherId: teacher.id, from, to, rows, text: formatAvailabilityCopy(rows), checkedAt: new Date().toISOString(), conflictCount, reviewCount};
}
