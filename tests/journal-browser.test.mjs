import test from 'node:test';
import assert from 'node:assert/strict';
import {journalAcademicYear,journalFile,journalBrowserUrl,selectJournalFiles,openJournalTabs} from '../src/lib/journal-browser.mjs';
import {teacherRouteAllowed} from '../src/lib/staff-teacher-route-access.mjs';
const file=(id,campus='本校',subjectId='math')=>({id,campus,subjectId,url:`https://onedrive.live.com/edit?id=${id}`});
test('年度切替は日本時間の3月、原本名だけを科目・校舎・区分へ分類する',()=>{
  assert.equal(journalAcademicYear(new Date('2027-02-28T14:59:59Z')),2026);
  assert.equal(journalAcademicYear(new Date('2027-02-28T15:00:00Z')),2027);
  assert.equal(journalFile('本校小４X算数_2026.xlsx','本校',2026,'小4').subjectId,'math');
  assert.equal(journalFile('南教室英語補講_2026.xlsx','南教室',2026).kind,'補講');
  for(const name of ['本校中２数学_2025.xlsx','本校中２数学_2026_before.xlsx','~$本校中２数学_2026.xlsx','南教室中２数学_2026.xlsx'])assert.equal(journalFile(name,'本校',2026,'中2'),null);
  assert.equal(journalFile('本校中２数学_2026.xlsx','本校',2026,'中3'),null);
});
test('科目・校舎で選び、同じ原本を重複して開かない',()=>{
  const files=[file('h'),file('s','南教室'),file('eng','本校','english'),file('h')];
  assert.equal(selectJournalFiles(files,'math','全部').length,2);
  assert.deepEqual(selectJournalFiles(files,'math','南教室').map(f=>f.id),['s']);
  assert.deepEqual(selectJournalFiles(files,'invalid','全部'),[]);
  assert.deepEqual(selectJournalFiles(files,'math','invalid'),[]);
});
test('ブラウザの安全な原本URLだけを扱い、ダウンロードURLを使わない',()=>{
  for(const url of ['javascript:alert(1)','http://onedrive.live.com/a','https://evil.invalid/a','https://onedrive.live.com.evil.invalid/a','https://user@onedrive.live.com/a','https://api.onedrive.com/download'])assert.equal(journalBrowserUrl(url),null);
  assert.ok(journalBrowserUrl('https://school.sharepoint.com/file'));
});
test('クリック内で同期的に起動し、ブロックされた原本だけを再試行する',()=>{
  const calls=[],opened={opener:'parent'};
  const result=openJournalTabs([file('one'),file('two'),file('one')],url=>{calls.push(url);return calls.length===1?opened:null;});
  assert.equal(result.requested,1);assert.equal(opened.opener,null);
  assert.deepEqual(result.blocked.map(f=>f.id),['two']);
  const retry=[];openJournalTabs(result.blocked,url=>{retry.push(url);return {};});
  assert.equal(retry.length,1);assert.match(retry[0],/two$/);
  assert.equal(openJournalTabs([file('x')],()=>{throw Error('blocked');}).blocked.length,1);
});
test('既存の先生ログインで日誌APIだけを追加利用できる',()=>{
  assert.equal(teacherRouteAllowed('/api/staff/journals'),true);
  assert.equal(teacherRouteAllowed('/api/staff/journals/admin'),false);
});
