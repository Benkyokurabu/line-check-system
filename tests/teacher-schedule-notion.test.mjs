import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTeacherNotionSync, BENSUKE_SOURCE_ID, KINJO_NOTION_TEACHER_ID, KUDO_NOTION_TEACHER_ID,
  planTeacherNotionLessons, prepareTeacherNotionSync,
} from '../src/lib/teacher-schedule-notion.mjs';

const month = '2026-10';
const staffSource = '19ef0120-80a7-8042-869a-000b871e5773';
const schema = { properties: {
  名前: { id: 'title', type: 'title' }, 日時: { id: 'date', type: 'date' },
  担当者: { id: 'teacher', type: 'relation', relation: { data_source_id: staffSource } },
  校舎: { id: 'campus', type: 'multi_select', multi_select: { options: [
    { id: 'hon', name: '本校' }, { id: 'minami', name: '南教室' },
  ] } },
  教室: { id: 'room', type: 'select', select: { options: [
    { id: 'hon1', name: '本①' }, { id: 'minami1', name: '南①' },
  ] } },
  内容: { id: 'tag', type: 'multi_select', multi_select: { options: [{ id: 'lesson', name: '授業' }] } },
  備考: { id: 'note', type: 'rich_text' },
} };

function row(date, campus, overrides = {}) {
  const source = { date, time: '5:00～6:30', grade: 'e6', class: 'X', subject: 'jp',
    campus, room: '1', groupKey: `${campus}_e6_X_jp`, label: '小6X 国語',
    displayTitle: '小6X 国語', faceToFace: false, special: false, teacher: '金城' };
  return { lesson_date: date, start_time: source.time, teacher_name: '金城', campus: campus === 'hon' ? '本校' : '南教室',
    source_payload: { ...source, ...overrides } };
}

function kudoRow(date, campus, overrides = {}) {
  const source = { date, time: '4:55～6:15', grade: 'e4', class: 'A', subject: 'arith',
    campus, room: '1', groupKey: `${campus}_e4_A_arith`, label: '小４A 算数',
    displayTitle: '', faceToFace: false, special: false, teacher: '工藤', ...overrides };
  return { lesson_date: date, start_time: source.time, teacher_name: '工藤',
    campus: campus === 'hon' ? '本校' : '南教室', source_payload: source };
}

function page(item, id) {
  return { id, parent: { data_source_id: BENSUKE_SOURCE_ID }, properties: {
    title: { id: 'title', title: [{ plain_text: item.title }] },
    date: { id: 'date', date: { start: item.start, end: item.end } },
    teacher: { id: 'teacher', relation: [{ id: item.teacherId }] },
    campus: { id: 'campus', multi_select: item.campus ? [{ name: item.campus }] : [] },
    room: { id: 'room', select: item.room ? { name: item.room } : null },
    tag: { id: 'tag', multi_select: [{ name: '授業' }] },
    note: { id: 'note', rich_text: item.note ? [{ plain_text: item.note }] : [] },
  } };
}

function fakeNotion(initial = []) {
  const pages = [...initial], calls = [];
  const request = async (path, init = {}) => {
    calls.push([path, init]);
    if (path === `/data_sources/${BENSUKE_SOURCE_ID}`) return schema;
    if (path === `/pages/${KINJO_NOTION_TEACHER_ID}` || path === `/pages/${KUDO_NOTION_TEACHER_ID}`) {
      const name = path.endsWith(KINJO_NOTION_TEACHER_ID) ? '金城先生' : '工藤先生';
      return { parent: { data_source_id: staffSource },
        properties: { 名前: { type: 'title', title: [{ plain_text: name }] } } };
    }
    if (path.endsWith('/query')) {
      const filter = JSON.parse(init.body).filter;
      const date = p => p.properties.date.date.start.slice(0, 10);
      const results = pages.filter(p => filter.and
        ? date(p) >= filter.and[0].date.on_or_after && date(p) <= filter.and[1].date.on_or_before
        : date(p) === filter.date.equals);
      return { results, has_more: false };
    }
    if (path === '/pages' && init.method === 'POST') {
      const { properties } = JSON.parse(init.body);
      const optionName = (field, id) => schema.properties[field][schema.properties[field].type].options.find(x => x.id === id).name;
      const item = { title: properties.title.title[0].text.content,
        teacherId: properties.teacher.relation[0].id,
        start: properties.date.date.start, end: properties.date.date.end,
        campus: properties.campus.multi_select[0] ? optionName('校舎', properties.campus.multi_select[0].id) : '',
        room: properties.room.select ? optionName('教室', properties.room.select.id) : '',
        note: properties.note?.rich_text[0]?.text.content ?? '' };
      const created = page(item, `new-${pages.length}`);
      pages.push(created);
      return created;
    }
    throw Error(`Unexpected Notion request ${path}`);
  };
  return { pages, calls, request };
}

test('groups both-campus Kinjo lessons as one card with location pending', () => {
  const items = planTeacherNotionLessons([
    row('2026-10-05', 'hon'), row('2026-10-05', 'minami'),
    row('2026-10-06', 'hon', { faceToFace: true }),
    { ...row('2026-10-07', 'hon'), teacher_name: '別の先生' },
  ], month);
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].title, items[0].campus, items[0].room, items[0].note],
    ['授業', '', '', '校舎・教室は確認中']);
  assert.equal(items[0].legacyTitle, '授業／６Ｘ国');
  assert.deepEqual([items[1].title, items[1].campus, items[1].room, items[1].note],
    ['授業', '本校', '本①', '']);
  assert.equal(items[1].legacyTitle, '授業／６Ｘ国対面');
  assert.equal(items[0].start, '2026-10-05T17:00:00+09:00');
});

test('Kudo normal and supplemental lessons use the verified teacher and merge both campuses', () => {
  const supplement = { grade: '', class: '', subject: '', label: '数学　　補講①',
    displayTitle: '数学　　補講①', special: true, isSpecialLesson: true,
    groupKey: 'hon_special_数学　　補講①' };
  const items = planTeacherNotionLessons([
    kudoRow('2026-10-05', 'hon'), kudoRow('2026-10-05', 'minami'),
    kudoRow('2026-10-03', 'hon', supplement), row('2026-10-03', 'hon'),
  ], month).filter(x => x.teacherId === KUDO_NOTION_TEACHER_ID);
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].title, items[0].campus, items[0].room],
    ['授業／数学補講①', '本校', '本①']);
  assert.deepEqual([items[1].title, items[1].campus, items[1].room, items[1].note],
    ['授業／４Ａ算', '', '', '校舎・教室は確認中']);
});

test('no Kinjo lessons does not require Notion configuration or a request', async () => {
  const result = await prepareTeacherNotionSync([{ ...row('2026-10-07', 'hon'), teacher_name: '別の先生' }], month);
  assert.deepEqual(result.items, []);
});

test('an already-created card is reused and a partial retry creates only the missing card', async () => {
  const rows = [row('2026-10-05', 'hon'), row('2026-10-05', 'minami'), row('2026-10-06', 'hon')];
  const planned = planTeacherNotionLessons(rows, month);
  const notion = fakeNotion([page(planned[0], 'existing-1')]);
  const first = await prepareTeacherNotionSync(rows, month, notion.request);
  assert.equal(first.existing, 1);
  assert.equal(first.locationPending, 1);
  assert.deepEqual(await applyTeacherNotionSync(first), { created: 1, existing: 1, locationPending: 1 });
  const second = await prepareTeacherNotionSync(rows, month, notion.request);
  assert.equal(second.existing, 2);
  assert.deepEqual(await applyTeacherNotionSync(second), { created: 0, existing: 2, locationPending: 1 });
  assert.equal(notion.calls.filter(([path, init]) => path === '/pages' && init.method === 'POST').length, 1);
});

test('an older Kinjo title remains untouched while its exact schedule is recognized', async () => {
  const rows = [row('2026-10-05', 'hon')];
  const [planned] = planTeacherNotionLessons(rows, month);
  const older = page({ ...planned, title: planned.legacyTitle }, 'older-card');
  const notion = fakeNotion([older]);
  const prepared = await prepareTeacherNotionSync(rows, month, notion.request);
  assert.equal(prepared.existing, 1);
  assert.deepEqual(await applyTeacherNotionSync(prepared), { created: 0, existing: 1, locationPending: 0 });
  assert.equal(notion.pages[0].properties.title.title[0].plain_text, '授業／６Ｘ国');
  assert.equal(notion.calls.filter(([path]) => path === '/pages').length, 0);
});

test('a failure after one new card resumes with only the two missing cards', async () => {
  const rows = ['2026-10-05', '2026-10-06', '2026-10-07'].map(date => row(date, 'hon'));
  const notion = fakeNotion();
  let posts = 0;
  const flakyRequest = (path, init) => {
    if (path === '/pages' && ++posts === 2) throw Error('temporary Notion failure');
    return notion.request(path, init);
  };
  const first = await prepareTeacherNotionSync(rows, month, flakyRequest);
  await assert.rejects(applyTeacherNotionSync(first), /temporary Notion failure/);
  assert.equal(notion.pages.length, 1);
  const retry = await prepareTeacherNotionSync(rows, month, notion.request);
  assert.equal(retry.existing, 1);
  assert.deepEqual(await applyTeacherNotionSync(retry), { created: 2, existing: 1, locationPending: 0 });
  assert.equal(notion.pages.length, 3);
});

test('a Kudo interview buffer holds only the conflicting lesson', async () => {
  const rows = [kudoRow('2026-10-16', 'hon'), kudoRow('2026-10-17', 'hon')];
  const planned = planTeacherNotionLessons(rows, month);
  const meeting = page({ ...planned[0], title: '面談',
    start: '2026-10-16T16:20:00+09:00', end: '2026-10-16T16:55:00+09:00' }, 'meeting');
  meeting.properties.tag.multi_select = [{ name: '面談(対面)' }];
  const notion = fakeNotion([meeting]);
  const prepared = await prepareTeacherNotionSync(rows, month, notion.request);
  assert.deepEqual(prepared.items.map(x => x.action), ['blocked', 'create']);
  const result = await applyTeacherNotionSync(prepared);
  assert.equal(result.created, 1);
  assert.deepEqual(result.blocked, [{ date: '2026-10-16', title: '授業／４Ａ算', teacherName: '工藤先生' }]);
  assert.equal(notion.pages.length, 2);
});

test('different content at the same time blocks creation before any write', async () => {
  const rows = [row('2026-10-05', 'hon')];
  const planned = planTeacherNotionLessons(rows, month);
  const notion = fakeNotion([page({ ...planned[0], title: '授業／５Ｘ国' }, 'conflict')]);
  await assert.rejects(prepareTeacherNotionSync(rows, month, notion.request));
  assert.equal(notion.calls.filter(([path]) => path === '/pages').length, 0);
});
