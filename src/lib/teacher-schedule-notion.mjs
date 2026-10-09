import {
  assertNoNotionConflicts, bookingSchema, equivalentSchedule, queryPages,
  scheduleProperties, scheduleValue,
} from './bensuke-booking.mjs';

export const KINJO_NOTION_TEACHER_ID = '19ef0120-80a7-8053-8b72-ff746d515684';
export const KUDO_NOTION_TEACHER_ID = '1a9f0120-80a7-8075-a4d1-f40ba213ee2e';
export const BENSUKE_SOURCE_ID = '19ef0120-80a7-80c4-a965-000b104ea319';
const STAFF_SOURCE_ID = '19ef0120-80a7-8042-869a-000b871e5773';
const teachers = [
  { key: '金城', name: '金城先生', id: KINJO_NOTION_TEACHER_ID },
  { key: '工藤', name: '工藤先生', id: KUDO_NOTION_TEACHER_ID },
];
const LOCATION_PENDING = '校舎・教室は確認中';
const grades = { e4: '4', e5: '5', e6: '6', j1: '1', j2: '2', j3: '3' };
const subjects = { arith: '算', math: '数', eng: '英', jp: '国', sci: '理', soc: '社' };
const roomNumbers = '①②③④⑤⑥⑦⑧⑨';
const teacherKey = value => String(value ?? '').normalize('NFKC').replace(/\s|先生/gu, '');
const teacherFor = row => teachers.find(x => x.key === teacherKey(row?.teacher_name));
export const isTrackedTeacherLesson = row => Boolean(teacherFor(row));
const fullWidth = value => String(value).replace(/[0-9A-Z]/gu, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0));

function timeRange(date, text) {
  const match = /^(\d{1,2}):(\d{2})[～~](\d{1,2}):(\d{2})$/u.exec(String(text ?? '').replace(/\s/gu, ''));
  if (!match) throw Error('対象の先生の授業時刻を確認できません。');
  const clock = (hour, minute) => {
    const h = Number(hour), m = Number(minute);
    if (h < 1 || h > 23 || m < 0 || m > 59) throw Error('対象の先生の授業時刻を確認できません。');
    return `${String(h < 10 ? h + 12 : h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  const start = clock(match[1], match[2]), end = clock(match[3], match[4]);
  if (end <= start) throw Error('対象の先生の授業終了時刻を確認できません。');
  return { start: `${date}T${start}:00+09:00`, end: `${date}T${end}:00+09:00` };
}

function sourceIdentity(row, month, teacher) {
  const source = row.source_payload;
  const special = source?.isSpecialLesson === true;
  if (!source || teacherKey(source.teacher) !== teacher.key || teacherKey(row.teacher_name) !== teacher.key
    || row.lesson_date !== source.date || row.start_time !== source.time
    || !row.lesson_date?.startsWith(`${month}-`)
    || (special ? source.special !== true || Boolean(source.grade || source.class || source.subject)
      || typeof source.label !== 'string' || !source.label.trim() || source.displayTitle !== source.label
      : !grades[source.grade] || !subjects[source.subject] || !/^[A-Z]$/u.test(source.class ?? ''))
    || typeof source.faceToFace !== 'boolean' || !['hon', 'minami'].includes(source.campus)
    || (source.room && !/^[1-9]$/u.test(String(source.room)))) {
    throw Error(`${teacher.name}の時間割に未確認の授業属性があります。`);
  }
  return source;
}

// The trusted schedule workbook can list one online lesson at both campuses.
// One teacher gets one Notion card, with its location unset until confirmed.
export function planTeacherNotionLessons(lessons, month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/u.test(month) || !Array.isArray(lessons)) throw Error('対象月を確認できません。');
  const groups = new Map();
  for (const row of lessons.filter(isTrackedTeacherLesson)) {
    const teacher = teacherFor(row);
    const source = sourceIdentity(row, month, teacher);
    const key = [teacher.key, source.date, source.time, source.isSpecialLesson ? source.label.replace(/\s/gu, '')
      : `${source.grade}|${source.class}|${source.subject}`].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ row, source, teacher });
  }
  const items = [];
  for (const group of groups.values()) {
    const [{ source, teacher }] = group;
    const stable = s => [s.date, s.time, s.grade, s.class, s.subject, teacherKey(s.teacher),
      s.label, s.displayTitle, s.faceToFace, s.special,
      String(s.groupKey ?? '').replace(/^(hon|minami)_/u, '')].join('|');
    if (group.some(x => stable(x.source) !== stable(source)) || group.length > 2) {
      throw Error(`${teacher.name}の同時刻授業を一件にまとめられません。`);
    }
    const campuses = group.map(x => x.source.campus);
    const dual = group.length === 2;
    if (dual && new Set(campuses).size !== 2) throw Error(`${teacher.name}の授業に同じ校舎の重複があります。`);
    const range = timeRange(source.date, source.time);
    const title = source.isSpecialLesson ? `授業／${source.label.replace(/\s/gu, '')}`
      : `授業／${fullWidth(`${grades[source.grade]}${source.class}${subjects[source.subject]}`)}${source.faceToFace ? '対面' : ''}`;
    const campus = dual ? '' : source.campus === 'hon' ? '本校' : '南教室';
    const room = dual || !source.room ? '' : `${source.campus === 'hon' ? '本' : '南'}${roomNumbers[Number(source.room) - 1]}`;
    items.push({ date: source.date, title, teacherId: teacher.id, teacherName: teacher.name,
      ...range, campus, room, roomNumber: dual ? '' : source.room,
      note: dual ? LOCATION_PENDING : '' });
  }
  const keys = items.map(x => `${x.teacherId}|${x.start}|${x.title}`);
  if (new Set(keys).size !== keys.length) throw Error('対象の先生の予定に重複する授業があります。');
  items.sort((a, b) => a.teacherId.localeCompare(b.teacherId) || a.start.localeCompare(b.start)
    || a.title.localeCompare(b.title, 'ja'));
  for (let i = 1; i < items.length; i++) {
    if (items[i - 1].teacherId === items[i].teacherId && items[i - 1].date === items[i].date
      && Date.parse(items[i - 1].end) > Date.parse(items[i].start)) {
      throw Error(`${items[i].teacherName}の授業時間が重なっています。`);
    }
  }
  return items;
}

export function createTeacherNotionRequest(token, fetcher = fetch) {
  if (!token) throw Error('Notion接続が設定されていません。');
  return async (path, init = {}) => {
    const response = await fetcher(`https://api.notion.com/v1${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'Notion-Version': process.env.NOTION_VERSION || '2025-09-03', ...init.headers },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error(`Notion HTTP ${response.status}`);
    return response.json();
  };
}

const expectedValue = item => ({ title: item.title,
  date: { start: item.start, end: item.end, time_zone: null },
  teachers: [item.teacherId], campuses: item.campus ? [item.campus] : [],
  room: item.room, tags: ['授業'] });
const noteValue = (page, schema) => (Object.values(page.properties ?? {}).find(x => x.id === schema.properties['備考'].id)?.rich_text
  ?? page.properties?.['備考']?.rich_text ?? [])
  .map(x => x.plain_text ?? x.text?.content ?? '').join('');
const sameStart = (a, b) => a && Date.parse(a) === Date.parse(b);

function classify(item, pages, schema) {
  const expected = expectedValue(item);
  const teacherPages = pages.map(page => ({ page, value: scheduleValue(page, schema) }))
    .filter(x => x.value.teachers.includes(item.teacherId));
  const sameTime = teacherPages.filter(x => sameStart(x.value.date?.start, item.start));
  if (sameTime.length) {
    if (sameTime.length !== 1 || !equivalentSchedule(sameTime[0].value, expected)
      || noteValue(sameTime[0].page, schema) !== item.note) {
      throw Error(`${item.date}の${item.teacherName}の既存授業と内容が異なります。`);
    }
    return { action: 'existing', pageId: sameTime[0].page.id, url: sameTime[0].page.url };
  }
  try {
    assertNoNotionConflicts(pages, { schema, data: { date: item.date,
      busyStart: item.start.slice(11, 16), busyEnd: item.end.slice(11, 16),
      campus: item.campus, room: item.roomNumber }, teacherId: item.teacherId, excludeId: '' });
  } catch (error) {
    if (error?.status === 409) return { action: 'blocked' };
    throw error;
  }
  return { action: 'create' };
}

export async function prepareTeacherNotionSync(lessons, month, request = null) {
  const items = planTeacherNotionLessons(lessons, month);
  if (!items.length) return { items, existing: 0, locationPending: 0, request: null, schema: null };
  request ??= createTeacherNotionRequest(process.env.NOTION_TOKEN || process.env.NOTION_API_KEY);
  const schema = await request(`/data_sources/${BENSUKE_SOURCE_ID}`);
  const fields = bookingSchema(schema);
  if (fields.teachers.relation.data_source_id !== STAFF_SOURCE_ID || schema.properties?.['備考']?.type !== 'rich_text') {
    throw Error('対象の先生のNotion予定の項目が変わっています。');
  }
  for (const match of teachers.filter(x => items.some(item => item.teacherId === x.id))) {
    const teacher = await request(`/pages/${match.id}`);
    const name = Object.values(teacher.properties ?? {}).filter(x => x.type === 'title')
      .flatMap(x => x.title ?? []).map(x => x.plain_text ?? x.text?.content ?? '').join('');
    if (name !== match.name || teacher.parent?.data_source_id !== STAFF_SOURCE_ID) {
      throw Error(`${match.name}の担当者カードを確認できません。`);
    }
  }
  const lastDay = `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`;
  const pages = await queryPages(request, BENSUKE_SOURCE_ID, { and: [
    { property: fields.date.id, date: { on_or_after: `${month}-01` } },
    { property: fields.date.id, date: { on_or_before: lastDay } },
  ] }, 30);
  const classified = items.map(item => ({ ...item, ...classify(item, pages, schema) }));
  return { items: classified, existing: classified.filter(x => x.action === 'existing').length,
    locationPending: items.filter(x => x.note).length, request, schema };
}

export async function applyTeacherNotionSync(prepared) {
  const { request, schema } = prepared;
  if (!prepared.items.length) return { created: 0, existing: 0, locationPending: 0 };
  const fields = bookingSchema(schema), noteField = schema.properties['備考'];
  let created = 0, existing = 0;
  const blocked = [];
  for (const item of prepared.items) {
    if (item.action === 'blocked') {
      blocked.push({ date: item.date, title: item.title, teacherName: item.teacherName });
      continue;
    }
    // A per-day read makes a partial retry safe even after an uncertain POST result.
    const pages = await queryPages(request, BENSUKE_SOURCE_ID,
      { property: fields.date.id, date: { equals: item.date } });
    const current = classify(item, pages, schema);
    if (current.action === 'existing') { existing++; continue; }
    if (current.action === 'blocked') {
      blocked.push({ date: item.date, title: item.title, teacherName: item.teacherName });
      continue;
    }
    const properties = scheduleProperties(expectedValue(item), schema);
    if (item.note) properties[noteField.id] = { rich_text: [{ text: { content: item.note } }] };
    const page = await request('/pages', { method: 'POST', body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: BENSUKE_SOURCE_ID }, properties,
    }) });
    if (page.parent?.data_source_id !== BENSUKE_SOURCE_ID
      || !equivalentSchedule(scheduleValue(page, schema), expectedValue(item))
      || noteValue(page, schema) !== item.note) throw Error(`${item.date}の作成結果を再確認してください。`);
    created++;
  }
  return { created, existing, locationPending: prepared.locationPending,
    ...(blocked.length ? { blocked } : {}) };
}
