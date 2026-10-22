import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildContext, historyKnowledge, loadStore, saveKnowledge, searchKnowledge } from './context-store.mjs';
import { main } from './cli.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bentan-knowledge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'source.txt'), '原文：母と本人は今回の事例。\n手順：登録数は人数と分ける。\n');
  const directory = path.join(root, 'store');
  const record = { id: 'roster-count', title: '登録数と人数', body: '登録数を人数と同一視しない。', category: 'criterion',
    assertion: 'user_decision', status: 'confirmed', checkedAt: '2026-10-22', validFrom: '2026-10-22', validUntil: null,
    scope: { campuses: [], grades: [], roles: [], subject: '' }, changeReason: '原文を確認して登録',
    sources: [{ path: 'source.txt', quote: '登録数は人数と分ける。', locator: '2行目' }] };
  const save = (overrides = {}, expectedRevision = 0) => saveKnowledge({ directory, workspaceRoot: root, expectedRevision, record: { ...record, ...overrides } });
  const search = (overrides = {}) => searchKnowledge({ directory, workspaceRoot: root, at: '2026-10-22', ...overrides });
  return { root, directory, record, save, search };
}

test('訂正は古い語句で検索しても復活せず履歴は保持する', async t => {
  const f = await fixture(t);
  await f.save({ body: '訂正前だけの語句' });
  await f.save({ body: '登録数を人数と同一視しない。', changeReason: '人数との混同を訂正' }, 1);
  assert.equal((await f.search({ query: '訂正前だけ' })).results.length, 0);
  const old = (await f.search({ query: '訂正前だけ', includeHistory: true })).results[0];
  assert.equal(old.usableAsRule, false);
  assert.ok(old.warnings.includes('superseded'));
  assert.equal((await historyKnowledge(f.directory, f.record.id)).length, 2);
});

test('出典と確認日を付けた現在の判断基準を検索できる', async t => {
  const f = await fixture(t); await f.save();
  const result = await f.search({ query: '登録数 人数' });
  assert.equal(result.totalMatches, 1);
  assert.equal(result.results[0].sources[0].state, 'unchanged');
  assert.equal(result.results[0].checkedAt, '2026-10-22');
  assert.equal(result.results[0].usableAsRule, true);
  assert.equal(buildContext(result).executionAuthorized, false);
});

test('原文更新後は確定済みの知識も要再確認になる', async t => {
  const f = await fixture(t); await f.save();
  await writeFile(path.join(f.root, 'source.txt'), '登録数は人数と分ける。追加訂正あり');
  const context = buildContext(await f.search());
  assert.equal(context.rules.length, 0);
  assert.equal(context.reference[0].verification, 'needs_review');
  assert.equal(context.requiresReview, true);
});

test('元資料がなくても知識を確定ルールとして使わない', async t => {
  const f = await fixture(t); await f.save();
  await rm(path.join(f.root, 'source.txt'));
  assert.equal((await f.search()).results[0].sources[0].state, 'unavailable');
  assert.equal(buildContext(await f.search()).rules.length, 0);
});

test('校舎・学年・役割を一致判定し、未指定は全体ルールにしない', async t => {
  const f = await fixture(t);
  await f.save({ scope: { campuses: ['本校'], grades: ['中３'], roles: ['工藤'], subject: '' } });
  assert.equal((await f.search({ scope: { campuses: '南教室' } })).results.length, 0);
  assert.equal((await f.search({ scope: { grades: '中２' } })).results.length, 0);
  assert.equal((await f.search({ scope: { roles: '別職員' } })).results.length, 0);
  assert.equal((await f.search()).results[0].usableAsRule, false);
  assert.equal((await f.search({ scope: { campuses: '本校', grades: '中３', roles: '工藤' } })).results[0].usableAsRule, true);
});

test('一人への事例を別人へ適用しない', async t => {
  const f = await fixture(t);
  await f.save({ category: 'case', scope: { campuses: [], grades: [], roles: [], subject: '事例A' } });
  assert.equal((await f.search({ scope: { subject: '事例B' } })).results.length, 0);
  const result = (await f.search({ scope: { subject: '事例A' } })).results[0];
  assert.equal(result.usableAsRule, false);
  assert.ok(result.warnings.includes('not_a_general_rule'));
});

test('改善案・推測・未確認情報は実行用の判断基準へ格上げしない', async t => {
  const f = await fixture(t);
  for (const [id, fields] of Object.entries({ proposal: { category: 'proposal', assertion: 'proposal' }, inference: { assertion: 'inference' }, question: { category: 'question', status: 'unconfirmed' } })) {
    await f.save({ id, ...fields });
  }
  assert.equal(buildContext(await f.search()).rules.length, 0);
});

test('適用期間の前後は現在のルールにしない', async t => {
  const f = await fixture(t); await f.save({ validUntil: '2026-10-23' });
  assert.equal((await f.search({ at: '2026-10-21' })).results[0].usableAsRule, false);
  assert.equal((await f.search({ at: '2026-10-23' })).results[0].usableAsRule, true);
  assert.equal((await f.search({ at: '2026-10-24' })).results[0].usableAsRule, false);
});

test('取り下げ後も過去版を自動復活させない', async t => {
  const f = await fixture(t); await f.save(); await f.save({ status: 'withdrawn', changeReason: '適用を取り下げ' }, 1);
  assert.equal((await f.search()).results.length, 0);
  assert.equal((await f.search({ includeHistory: true })).results.every(r => !r.usableAsRule), true);
});

test('誤った期待版による保存は元データを変えない', async t => {
  const f = await fixture(t); await f.save();
  const before = await readFile(path.join(f.directory, 'records.json'), 'utf8');
  await assert.rejects(f.save({}, 0), /Revision conflict/);
  assert.equal(await readFile(path.join(f.directory, 'records.json'), 'utf8'), before);
  await f.save({ changeReason: '最新版を読んで更新' }, 1);
});

test('同時保存は一方だけ成功し、履歴の欠落を防ぐ', async t => {
  const f = await fixture(t); await f.save();
  const results = await Promise.allSettled([f.save({ changeReason: '更新A' }, 1), f.save({ changeReason: '更新B' }, 1)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await historyKnowledge(f.directory, f.record.id)).length, 2);
});

test('出典にない引用を根拠付きで登録できない', async t => {
  const f = await fixture(t);
  await assert.rejects(f.save({ sources: [{ path: 'source.txt', quote: '原文にない内容', locator: '不明' }] }), /does not match/);
  assert.equal((await loadStore(f.directory)).entries.length, 0);
  await f.save();
});

test('許可した参照範囲を超えるファイルを読まない', async t => {
  const f = await fixture(t);
  await assert.rejects(f.save({ sources: [{ path: '../outside.txt', quote: '原文', locator: '原文' }] }));
  assert.equal((await loadStore(f.directory)).entries.length, 0);
});

test('外部資料は明示的な参照ルートがある場合だけ取得する', async t => {
  const f = await fixture(t); const other = await fixture(t);
  const record = { ...f.record, sources: [{ path: path.join(other.root, 'source.txt'), quote: '登録数は人数と分ける。', locator: '2行目' }] };
  await assert.rejects(saveKnowledge({ directory: f.directory, workspaceRoot: f.root, record, expectedRevision: 0 }), /outside allowed/);
  await saveKnowledge({ directory: f.directory, workspaceRoot: f.root, record, expectedRevision: 0, allowedSourceRoots: [other.root] });
  assert.equal((await f.search()).results[0].verification, 'needs_review');
  assert.equal((await f.search({ allowedSourceRoots: [other.root] })).results[0].verification, 'confirmed');
});

test('履歴ファイルが壊れていれば空データとして続けない', async t => {
  const f = await fixture(t); await f.save();
  const file = path.join(f.directory, 'records.json');
  const store = JSON.parse(await readFile(file, 'utf8'));
  store.entries[0].revisions[0].body = '外部から書き換え';
  await writeFile(file, JSON.stringify(store));
  await assert.rejects(f.search(), /hash mismatch/);
});

test('日付・分類・根拠・版の欠落を拒否する', async t => {
  const f = await fixture(t);
  for (const fields of [{ id: undefined }, { checkedAt: '2026-02-30' }, { category: 'unknown' }, { sources: [] }, { scope: {} }, { validUntil: '2026-10-01' }]) {
    await assert.rejects(f.save(fields));
  }
  await assert.rejects(f.search({ at: 'tomorrow' }));
  await assert.rejects(f.search({ limit: 0 }));
});

test('CLIから保存・条件検索・文脈取得・履歴取得ができる', async t => {
  const f = await fixture(t); await writeFile(path.join(f.root, 'draft.json'), JSON.stringify(f.record));
  await main(['save', '--root', f.root, '--directory', 'store', '--file', 'draft.json', '--expected-revision', '0']);
  const common = ['--root', f.root, '--directory', 'store'];
  assert.equal((await main(['search', ...common, '--query', '人数', '--at', '2026-10-22'])).totalMatches, 1);
  assert.equal((await main(['context', ...common, '--at', '2026-10-22'])).rules.length, 1);
  assert.equal((await main(['history', ...common, '--id', 'roster-count'])).length, 1);
  await assert.rejects(main(['save', ...common, '--file', 'draft.json']), /expected-revision/);
  await assert.rejects(main(['search', '--wrong', 'x']), /Invalid option/);
});

test('シンボリックリンク経由で外部の根拠を取り込まない', async t => {
  const f = await fixture(t); const other = await fixture(t);
  try { await symlink(other.root, path.join(f.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symlink privilege unavailable'); return; } throw error; }
  await assert.rejects(f.save({ sources: [{ path: 'link/source.txt', quote: '登録数は人数と分ける。', locator: '2行目' }] }), /outside allowed/);
});
