import test from 'node:test';
import assert from 'node:assert/strict';
import { filterHokushinSchools, renderOfflineSchoolLibrary, validateHokushinCatalog } from '../src/lib/hokushin-school-library.mjs';
import { teacherRouteAllowed } from '../src/lib/staff-teacher-route-access.mjs';

const item = { id: 'a'.repeat(64), school: '川口（普通）', reading: 'か川口（普通）', category: '公立', year: 2027,
  bytes: 100, storagePath: `hokushin-library/pdf/${'a'.repeat(64)}.pdf` };
test('catalog restricts paths and rejects missing, repeated or malformed school records', () => {
  assert.equal(validateHokushinCatalog({ version: 1, items: [item] }).items.length, 1);
  for (const items of [[], [item, item], [{ ...item, storagePath: 'jobs/another/bundle.pdf' }],
    [{ ...item, storagePath: 'hokushin-library/pdf/../secret.pdf' }], [{ ...item, year: '2027' }],
    [{ ...item, school: '' }], [{ ...item, bytes: 53_000_000 }]])
    assert.throws(() => validateHokushinCatalog({ version: 1, items }));
});
test('search matches partial school and course names, kana and category', () => {
  const items = [item, { ...item, school: 'いいずみ（生物系）', reading: 'いいずみ', category: '公立' },
    { ...item, school: '叡明', reading: 'え叡明', category: '私立' }];
  assert.equal(filterHokushinSchools(items, '川口（普通）').length, 1);
  assert.equal(filterHokushinSchools(items, ' イイズミ ').length, 1);
  assert.equal(filterHokushinSchools(items, '', '私立')[0].school, '叡明');
  assert.equal(filterHokushinSchools(items, '川口', '私立').length, 0);
});
test('shared teacher accounts may access only the exact school library endpoint', () => {
  assert.equal(teacherRouteAllowed('/api/staff/interview-material-school-library'), true);
  assert.equal(teacherRouteAllowed('/api/staff/interview-material-school-library/admin'), false);
});
test('standalone HTML contains only local school references and safely escapes school names', () => {
  const html = renderOfflineSchoolLibrary('__SCHOOLS_JSON__; __CAPTURED_AT_JSON__',
    [{ ...item, school: '</script><script>alert(1)</script>', previewUrl: 'https://secret.example/signed', studentNumber: '2018998' }], '2026-10-03');
  assert.ok(html.includes(`pdf/${item.id}.pdf`));
  assert.ok(html.includes('\\u003c'));
  assert.ok(!html.includes('</script>'));
  assert.ok(!html.includes('secret.example'));
  assert.ok(!html.includes('2018998'));
  assert.throws(() => renderOfflineSchoolLibrary('__ITEMS_JSON__', [item], '2026-10-03'));
});
