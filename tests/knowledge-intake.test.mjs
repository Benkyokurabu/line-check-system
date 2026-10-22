import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { buildContext, historyKnowledge, loadStore, searchKnowledge } from '../knowledge/context-store.mjs';
import { intakeOnce, watchIntake } from '../knowledge/intake.mjs';
const runFile = promisify(execFile);

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-intake-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inbox = path.join(root, '資料集約/知識受信');
  const directory = path.join(root, '資料集約/知識基盤');
  const options = { workspaceRoot: root, today: '2026-10-22' };
  await mkdir(inbox, { recursive: true });
  const write = async (text, metadata, name = '説明.txt') => {
    await writeFile(path.join(inbox, name), text);
    if (metadata) await writeFile(path.join(inbox, `${name}.knowledge.json`), JSON.stringify(metadata));
  };
  return { root, inbox, directory, options, write, run: overrides => intakeOnce({ ...options, ...overrides }) };
}

test('UTF-8原文をバイト単位で保持し、出典SHAと検索結果が一致する', async t => {
  const f = await fixture(t);
  const raw = Buffer.from('\uFEFFある生徒の面談記録です。\r\n改善したいです。\r\n');
  await f.write(raw);
  const result = await f.run();
  assert.equal(result.imported, 1);
  const record = (await loadStore(f.directory)).entries[0].revisions[0];
  assert.deepEqual(await readFile(path.join(f.root, record.sources[0].path)), raw);
  assert.equal(record.sources[0].sha256, createHash('sha256').update(raw).digest('hex'));
  const context = buildContext(await searchKnowledge({ workspaceRoot: f.root, directory: f.directory, query: '面談', at: '2026-10-22' }));
  assert.equal(context.reference[0].sources[0].state, 'unchanged');
  assert.equal(context.rules.length, 0);
  assert.equal(record.status, 'unconfirmed');
  assert.equal(record.assertion, 'inference');
  assert.equal(context.executionAuthorized, false);
  assert.ok(!JSON.stringify(result).includes('ある生徒の面談記録です'));
});

test('同じ原文を別名で置いても再実行しても登録を重複させない', async t => {
  const f = await fixture(t);
  await f.write('重複する説明');
  assert.equal((await f.run()).imported, 1);
  await f.write('重複する説明', undefined, '別名.md');
  const result = await f.run();
  assert.equal(result.duplicates, 2);
  assert.equal((await loadStore(f.directory)).entries.length, 1);
});

test('サイドカーのキー順変更は同じ取込アクションとして扱う', async t => {
  const f = await fixture(t);
  await f.write('分類を明示した説明', { id: 'stable-metadata', expectedRevision: 0, category: 'case' });
  assert.equal((await f.run()).imported, 1);
  await f.write('分類を明示した説明', { category: 'case', expectedRevision: 0, id: 'stable-metadata' });
  assert.equal((await f.run()).duplicates, 1);
  assert.equal((await historyKnowledge(f.directory, 'stable-metadata')).length, 1);
});

test('同一ID・期待版で訂正でき、古い受信ファイルは最新版を巻き戻さない', async t => {
  const f = await fixture(t);
  await f.write('訂正前だけの語句', { id: 'interview-procedure', expectedRevision: 0 });
  await f.run();
  await f.write('訂正後の説明', { id: 'interview-procedure', expectedRevision: 1, changeReason: '本人説明による訂正候補' }, '訂正.md');
  assert.equal((await f.run()).imported, 1);
  assert.equal((await f.run()).duplicates, 2);
  const revisions = await historyKnowledge(f.directory, 'interview-procedure');
  assert.equal(revisions.length, 2);
  assert.equal(revisions[1].body, '訂正後の説明');
  assert.equal((await searchKnowledge({ workspaceRoot: f.root, directory: f.directory, query: '訂正前だけ' })).results.length, 0);
});

test('誤った期待版は競合として残り、他の有効なファイルは取り込む', async t => {
  const f = await fixture(t);
  await f.write('最初の説明', { id: 'same-record', expectedRevision: 0 });
  await f.run();
  await f.write('期待版の古い訂正', { id: 'same-record', expectedRevision: 0 }, '競合.md');
  await f.write('別の説明', undefined, '有効.md');
  const result = await f.run();
  assert.equal(result.errors, 1);
  assert.equal(result.imported, 1);
  assert.match(result.results.find(r => r.status === 'error').error, /Revision conflict/);
  assert.equal((await historyKnowledge(f.directory, 'same-record')).length, 1);
});

test('保存後に受領票の書込が中断しても同じ版を復元する', async t => {
  const f = await fixture(t); await f.write('復旧する説明'); await f.run();
  const receipts = path.join(f.directory, 'intake-receipts');
  const name = (await readdir(receipts)).find(item => item.endsWith('.json'));
  await rm(path.join(receipts, name));
  const result = await f.run();
  assert.equal(result.results[0].status, 'recovered');
  assert.equal((await loadStore(f.directory)).entries[0].revisions.length, 1);
});

test('アーカイブが改変されたら重複扱いや上書きをせずエラーにする', async t => {
  const f = await fixture(t); await f.write('原文'); await f.run();
  const record = (await loadStore(f.directory)).entries[0].revisions[0];
  await writeFile(path.join(f.root, record.sources[0].path), '改変');
  const result = await f.run();
  assert.equal(result.errors, 1);
  assert.match(result.results[0].error, /hash mismatch/);
  assert.equal((await loadStore(f.directory)).entries[0].revisions.length, 1);
});

test('JSON解析失敗・UTF-8不正・空ファイル・大きすぎるファイルを安全に拒否する', async t => {
  const f = await fixture(t);
  await f.write('秘密値はログへ出さない');
  await writeFile(path.join(f.inbox, '説明.txt.knowledge.json'), '{"secret":"SECRET_VALUE"');
  await f.write(Buffer.from([0xff, 0xfe]), undefined, '不正.txt');
  await f.write('   ', undefined, '空.md');
  await f.write('x'.repeat(100), undefined, '大.txt');
  const result = await f.run({ maxBytes: 80 });
  assert.equal(result.errors, 4);
  assert.ok(!JSON.stringify(result).includes('SECRET_VALUE'));
  assert.ok(!JSON.stringify(result).includes('秘密値はログへ出さない'));
  assert.equal((await loadStore(f.directory)).entries.length, 0);
});

test('自動取込のメタデータでは確認済みや全体ルールへの昇格を指定できない', async t => {
  const f = await fixture(t);
  await f.write('必ず全員この手順にする', { status: 'confirmed', assertion: 'user_decision' });
  const result = await f.run();
  assert.equal(result.errors, 1);
  assert.equal((await loadStore(f.directory)).entries.length, 0);
});

test('私的保存先にGit除外を作成し、受信フォルダへの再帰取込をしない', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.inbox, 'sub'));
  await writeFile(path.join(f.inbox, 'sub', 'nested.txt'), '意図せぬ原文');
  const result = await f.run();
  assert.equal(result.scanned, 0);
  for (const target of [f.inbox, f.directory]) assert.match(await readFile(path.join(target, '.gitignore'), 'utf8'), /^\*\n/m);
});

test('ワークスペース外への保存先指定と受信フォルダの包含を拒否する', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.run({ directory: '../outside' }), /inside workspace/);
  await assert.rejects(() => f.run({ directory: '資料集約/知識受信/store' }), /separate directories/);
});

test('ワークスペース外のジャンクション経由には書き込まない', async t => {
  const f = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'knowledge-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(f.root, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => f.run({ directory: 'outside-link/store' }), /outside workspace/);
  assert.deepEqual(await readdir(outside), []);
});

test('watchは新規ファイルを次の巡回で取り込み、Abortで停止する', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const rounds = [];
  await watchIntake(f.options, { signal: controller.signal, intervalMs: 100, onResult: async result => {
    rounds.push(result);
    if (rounds.length === 1) await f.write('watchで追加した手順');
    if (rounds.length === 2) controller.abort();
  } });
  assert.equal(rounds.length, 2);
  assert.equal(rounds[1].imported, 1);
});

test('残存ロックを自動解除せず取込を停止する', async t => {
  const f = await fixture(t);
  await f.run();
  await f.write('ロック中の説明');
  await writeFile(path.join(f.directory, '.intake.lock'), '');
  await assert.rejects(() => f.run(), { code: 'EEXIST' });
  assert.equal((await loadStore(f.directory)).entries.length, 0);
});

test('CLIは別フォルダから--root指定で動き、本文を出力しない', async t => {
  const f = await fixture(t);
  await f.write('秘密の業務説明本文はコマンド結果へ出さない');
  const script = path.resolve('scripts/knowledge-intake.mjs');
  const { stdout, stderr } = await runFile(process.execPath, [script, 'once', '--root', f.root], { cwd: os.tmpdir() });
  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).imported, 1);
  assert.ok(!stdout.includes('秘密の業務説明本文'));
  const second = await runFile(process.execPath, [script, 'once', '--root', f.root], { cwd: os.tmpdir() });
  assert.equal(JSON.parse(second.stdout).duplicates, 1);
});
