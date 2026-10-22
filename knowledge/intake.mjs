import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { categories, historyKnowledge, saveKnowledge } from './context-store.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const isWithin = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

async function privateDirectory(root, target) {
  requireValue(isWithin(root, target), 'Intake directory must be inside workspace');
  // Check every existing ancestor before creating anything through a junction/symlink.
  let ancestor = target;
  while (true) {
    try { requireValue(isWithin(root, await realpath(ancestor)), 'Intake directory resolves outside workspace'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
  }
  await mkdir(target, { recursive: true });
  requireValue(isWithin(root, await realpath(target)), 'Intake directory resolves outside workspace');
  try { await writeExclusive(path.join(target, '.gitignore'), '*\n!.gitignore\n'); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

async function writeExclusive(filename, bytes) {
  const file = await open(filename, 'wx');
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}

async function readInside(root, filename, maxBytes = Infinity) {
  const actual = await realpath(filename);
  requireValue(isWithin(root, actual), 'Input resolves outside workspace');
  requireValue((await stat(actual)).size <= maxBytes, 'Input exceeds maxBytes');
  const bytes = await readFile(actual);
  requireValue(bytes.length <= maxBytes, 'Input exceeds maxBytes');
  return bytes;
}

/** A classification suggestion, never an assertion that the text is a confirmed policy. */
export function suggestIntake(text) {
  const candidates = [];
  for (const [category, pattern] of [
    ['proposal', /改善|提案|したい|どうでしょう|希望/],
    ['question', /未確認|不明|でしょうか|ですか|[?？]/],
    ['case', /ある生徒|この生徒|今回の|個別|面談/],
    ['exception', /ただし|例外|場合は別/],
    ['procedure', /手順|保存|登録|順番/],
    ['decision', /決定|決めました|運用にします/],
  ]) if (pattern.test(text)) candidates.push(category);
  return { categories: candidates.length ? candidates : ['observation'], uncertainties: [
    '説明が現行手順・個別事例・改善希望のどれに当たるかを原文と照合する',
    '適用する校舎・学年・役割・個別対象と、業務を確認した日付を確認する',
    '自動取込は原文の保存であり、全体ルールの承認や外部操作の許可を意味しない',
  ] };
}

function parseMetadata(bytes) {
  const value = bytes ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')) : {};
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Metadata must be an object');
  const allowed = new Set(['id', 'expectedRevision', 'title', 'category', 'checkedAt', 'validFrom', 'validUntil', 'scope', 'changeReason']);
  requireValue(Object.keys(value).every(key => allowed.has(key)), 'Unsupported metadata field; confirmation requires reviewed save API');
  requireValue(value.id === undefined || (typeof value.id === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(value.id)), 'Invalid metadata id');
  requireValue(value.expectedRevision === undefined || (Number.isInteger(value.expectedRevision) && value.expectedRevision >= 0), 'Invalid expectedRevision');
  requireValue(!value.expectedRevision || value.id, 'Correction requires explicit id');
  requireValue(value.id === undefined || value.expectedRevision !== undefined, 'Explicit id requires expectedRevision');
  requireValue(value.category === undefined || categories.includes(value.category), 'Invalid metadata category');
  return value;
}

async function ingestFile({ root, inbox, directory, filename, maxBytes, today }) {
  const input = path.join(inbox, filename);
  const bytes = await readInside(root, input, maxBytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  requireValue(text.trim().length > 0, 'Input is empty');
  let metadataBytes;
  try { metadataBytes = await readInside(root, `${input}.knowledge.json`, maxBytes); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const metadata = parseMetadata(metadataBytes);
  const sha256 = hash(bytes);
  const expectedRevision = metadata.expectedRevision ?? 0;
  const id = metadata.id ?? `intake-${sha256.slice(0, 40)}`;
  const action = hash(canonical({ sha256, metadata }));
  const locator = `intake:${action}`;
  const archive = path.join(directory, 'originals', `${sha256}.txt`);
  const receiptPath = path.join(directory, 'intake-receipts', `${action}.json`);
  const suggestions = suggestIntake(text);
  try {
    const receipt = JSON.parse(await readInside(root, receiptPath));
    const revisions = await historyKnowledge(directory, id);
    requireValue(receipt.id === id && receipt.sha256 === sha256 && receipt.action === action &&
      revisions[receipt.revision - 1]?.sources.some(s => s.locator === locator && s.sha256 === sha256), 'Intake receipt does not match stored revision');
    requireValue(hash(await readInside(root, archive)) === sha256, 'Archived original hash mismatch');
    return { file: filename, id, revision: receipt.revision, status: 'duplicate', sha256 };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await writeExclusive(archive, bytes); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  requireValue(hash(await readInside(root, archive)) === sha256, 'Archived original hash mismatch');
  const sourcePath = path.relative(root, archive).split(path.sep).join('/');
  const revisions = await historyKnowledge(directory, id);
  const recovered = revisions[expectedRevision];
  // Recover only this exact action after a crash between the store write and receipt write.
  let saved;
  if (recovered?.sources.some(s => s.locator === locator && s.sha256 === sha256)) saved = recovered;
  else saved = await saveKnowledge({ directory, workspaceRoot: root, expectedRevision, record: {
    id, title: metadata.title ?? '受信した業務説明（未確認）', body: text,
    category: metadata.category ?? suggestions.categories[0], assertion: 'inference', status: 'unconfirmed',
    checkedAt: metadata.checkedAt ?? today, validFrom: metadata.validFrom ?? today, validUntil: metadata.validUntil ?? null,
    scope: metadata.scope ?? { campuses: [], grades: [], roles: [], subject: '' },
    changeReason: metadata.changeReason ?? (expectedRevision ? '受信原文による訂正候補（未確認）' : '受信原文の自動保存（業務内容は未確認）'),
    sources: [{ path: sourcePath, locator, quote: text }],
  } });
  const receipt = { schemaVersion: 1, action, id, revision: saved.revision, sha256, sourcePath,
    importedAt: saved.recordedAt, businessCheckedAtProvided: metadata.checkedAt !== undefined,
    suggestions, status: 'unconfirmed' };
  const temporary = `${receiptPath}.${randomUUID()}.tmp`;
  try { await writeExclusive(temporary, JSON.stringify(receipt, null, 2) + '\n'); await rename(temporary, receiptPath); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return { file: filename, id, revision: saved.revision, status: recovered === saved ? 'recovered' : 'imported', sha256,
    categoryCandidates: suggestions.categories, needsReview: true };
}

/** Process UTF-8 text/Markdown once. Originals remain in the inbox and in a hash-addressed archive. */
export async function intakeOnce({ workspaceRoot, inbox: inboxOption = '資料集約/知識受信',
  directory: directoryOption = '資料集約/知識基盤', maxBytes = 1024 * 1024,
  today = new Date().toISOString().slice(0, 10) }) {
  requireValue(Number.isInteger(maxBytes) && maxBytes > 0, 'Invalid maxBytes');
  const root = await realpath(path.resolve(workspaceRoot));
  const inbox = path.resolve(root, inboxOption);
  const directory = path.resolve(root, directoryOption);
  requireValue(inbox !== directory && !isWithin(inbox, directory) && !isWithin(directory, inbox), 'Inbox and store must be separate directories');
  for (const target of [inbox, directory, path.join(directory, 'originals'), path.join(directory, 'intake-receipts')]) await privateDirectory(root, target);
  const lockPath = path.join(directory, '.intake.lock');
  const lock = await open(lockPath, 'wx');
  try {
    const files = (await readdir(inbox, { withFileTypes: true })).filter(entry => entry.isFile() && /\.(txt|md)$/i.test(entry.name)).map(entry => entry.name).sort();
    const results = [];
    for (const filename of files) {
      try { results.push(await ingestFile({ root, inbox, directory, filename, maxBytes, today })); }
      catch (error) { results.push({ file: filename, status: 'error', error: error instanceof SyntaxError ? 'Invalid UTF-8 or metadata JSON' : error.message }); }
    }
    return { scanned: files.length, imported: results.filter(r => r.status === 'imported' || r.status === 'recovered').length,
      duplicates: results.filter(r => r.status === 'duplicate').length, errors: results.filter(r => r.status === 'error').length, results };
  } finally { try { await lock.close(); } finally { await unlink(lockPath); } }
}

/** Serial polling avoids overlapping scans. onResult receives metadata only, never original text. */
export async function watchIntake(options, { signal, intervalMs = 3000, onResult = () => {} } = {}) {
  requireValue(Number.isInteger(intervalMs) && intervalMs >= 100, 'Invalid intervalMs');
  while (!signal?.aborted) {
    await onResult(await intakeOnce(options));
    if (signal?.aborted) break;
    await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, intervalMs);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
}
