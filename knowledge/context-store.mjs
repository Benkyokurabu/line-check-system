import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const categories = ['procedure', 'criterion', 'exception', 'case', 'observation', 'proposal', 'decision', 'question'];
export const assertions = ['observed', 'user_decision', 'proposal', 'inference'];
export const statuses = ['confirmed', 'unconfirmed', 'withdrawn'];
const axes = ['campuses', 'grades', 'roles'];
const ruleCategories = new Set(['procedure', 'criterion', 'exception', 'decision']);
const digest = value => createHash('sha256').update(value).digest('hex');
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const canonical = value => JSON.stringify(value);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function validDate(value) {
  return typeof value === 'string' && datePattern.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validateRecord(record) {
  requireValue(record && typeof record === 'object', 'Record is required');
  requireValue(typeof record.id === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(record.id), 'Invalid knowledge id');
  for (const key of ['title', 'body', 'changeReason']) {
    requireValue(typeof record[key] === 'string' && record[key].trim().length > 0, `${key} is required`);
  }
  requireValue(categories.includes(record.category), 'Invalid category');
  requireValue(assertions.includes(record.assertion), 'Invalid assertion');
  requireValue(statuses.includes(record.status), 'Invalid status');
  requireValue(validDate(record.checkedAt), 'Invalid checkedAt date');
  requireValue(validDate(record.validFrom), 'Invalid validFrom date');
  requireValue(record.validUntil === null || validDate(record.validUntil), 'Invalid validUntil date');
  requireValue(record.validUntil === null || record.validFrom <= record.validUntil, 'Invalid validity period');
  requireValue(record.scope && typeof record.scope.subject === 'string', 'Explicit subject scope is required');
  for (const key of axes) {
    requireValue(Array.isArray(record.scope[key]) && record.scope[key].every(v => typeof v === 'string' && v.trim()), `Invalid scope.${key}`);
  }
  requireValue(Array.isArray(record.sources) && record.sources.length > 0, 'At least one source is required');
  for (const source of record.sources) {
    requireValue(source && typeof source.path === 'string' && source.path.length > 0, 'Source path required');
    requireValue(typeof source.quote === 'string' && source.quote.trim().length > 0, 'Source quote required');
    requireValue(typeof source.locator === 'string' && source.locator.trim().length > 0, 'Source locator required');
  }
  return record;
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function sourceBytes(sourcePath, { workspaceRoot, allowedSourceRoots = [] }) {
  requireValue(typeof workspaceRoot === 'string', 'workspaceRoot required');
  const roots = await Promise.all([workspaceRoot, ...allowedSourceRoots].map(root => realpath(root)));
  const target = await realpath(path.resolve(workspaceRoot, sourcePath));
  requireValue(roots.some(root => within(root, target)), 'Source is outside allowed roots');
  return readFile(target);
}

/** Sources stay at their original location. Only the selected quote and content hash are stored. */
export async function captureSources(sources, options) {
  const result = [];
  for (const source of sources) {
    const bytes = await sourceBytes(source.path, options);
    requireValue(bytes.toString('utf8').replace(/\r\n/g, '\n').includes(source.quote.replace(/\r\n/g, '\n')), 'Source quote does not match original');
    result.push({ path: source.path, locator: source.locator, quote: source.quote, sha256: digest(bytes) });
  }
  return result;
}

function validateStore(store) {
  requireValue(store.schemaVersion === 1 && Array.isArray(store.entries), 'Unsupported knowledge store');
  const ids = new Set();
  for (const entry of store.entries) {
    requireValue(!ids.has(entry.id), 'Duplicate knowledge id');
    ids.add(entry.id);
    requireValue(Array.isArray(entry.revisions) && entry.revisions.length > 0, 'Empty revision history');
    let previousHash = null;
    entry.revisions.forEach((record, i) => {
      validateRecord(record);
      requireValue(record.id === entry.id && record.revision === i + 1, 'Broken revision sequence');
      requireValue(record.previousHash === previousHash, 'Broken correction history');
      requireValue(record.sources.every(s => /^[a-f0-9]{64}$/.test(s.sha256)), 'Missing source hash');
      const { hash, ...payload } = record;
      requireValue(hash === digest(canonical(payload)), 'Knowledge record hash mismatch');
      previousHash = hash;
    });
  }
  return store;
}

export async function loadStore(directory) {
  try {
    return validateStore(JSON.parse((await readFile(path.join(directory, 'records.json'), 'utf8')).replace(/^\uFEFF/, '')));
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, entries: [] };
    throw error;
  }
}

/** Optimistic revision check plus exclusive lock; a crash leaves the lock for deliberate recovery. */
export async function saveKnowledge({ directory, record, expectedRevision, workspaceRoot, allowedSourceRoots = [] }) {
  validateRecord(record);
  requireValue(Number.isInteger(expectedRevision) && expectedRevision >= 0, 'expectedRevision required');
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, '.write.lock');
  const lock = await open(lockPath, 'wx');
  const temporary = path.join(directory, `.records-${process.pid}-${Date.now()}.tmp`);
  try {
    const store = await loadStore(directory);
    let entry = store.entries.find(item => item.id === record.id);
    const previous = entry?.revisions.at(-1);
    requireValue((previous?.revision ?? 0) === expectedRevision, 'Revision conflict; read latest before saving');
    const sources = await captureSources(record.sources, { workspaceRoot, allowedSourceRoots });
    const payload = { id: record.id, title: record.title, body: record.body, category: record.category,
      assertion: record.assertion, status: record.status, checkedAt: record.checkedAt,
      validFrom: record.validFrom, validUntil: record.validUntil, scope: record.scope,
      changeReason: record.changeReason, sources, revision: expectedRevision + 1,
      previousHash: previous?.hash ?? null, recordedAt: new Date().toISOString() };
    const revision = { ...payload, hash: digest(canonical(payload)) };
    if (!entry) { entry = { id: record.id, revisions: [] }; store.entries.push(entry); }
    entry.revisions.push(revision);
    validateStore(store);
    const file = await open(temporary, 'wx');
    try { await file.writeFile(JSON.stringify(store, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path.join(directory, 'records.json'));
    return revision;
  } finally {
    try { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    finally { try { await lock.close(); } finally { await unlink(lockPath); } }
  }
}

async function assessSources(record, options, cache) {
  const evidence = [];
  for (const source of record.sources) {
    if (!cache.has(source.path)) {
      cache.set(source.path, sourceBytes(source.path, options).then(bytes => ({ sha256: digest(bytes) })).catch(() => ({ unavailable: true })));
    }
    const current = await cache.get(source.path);
    evidence.push({ ...source, state: current.unavailable ? 'unavailable' : current.sha256 === source.sha256 ? 'unchanged' : 'changed' });
  }
  return evidence;
}

/** Searches derived records only. Reads original source bytes just for matching records. */
export async function searchKnowledge({ directory, workspaceRoot, allowedSourceRoots = [], query = '',
  scope = {}, at = new Date().toISOString().slice(0, 10), limit = 10, includeHistory = false }) {
  requireValue(validDate(at), 'Invalid query date');
  requireValue(Number.isInteger(limit) && limit > 0 && limit <= 100, 'limit must be 1..100');
  for (const key of axes) requireValue(scope[key] === undefined || typeof scope[key] === 'string', `Invalid query scope.${key}`);
  requireValue(scope.subject === undefined || typeof scope.subject === 'string', 'Invalid query subject');
  const store = await loadStore(directory);
  const terms = normalize(query).split(' ').filter(Boolean);
  const candidates = [];
  for (const entry of store.entries) {
    // Pick the current revision before matching text: an old phrase must never resurrect a correction.
    const revisions = includeHistory ? entry.revisions : [entry.revisions.at(-1)];
    for (const record of revisions) {
      const historical = record.revision !== entry.revisions.at(-1).revision;
      if (!includeHistory && record.status === 'withdrawn') continue;
      const haystack = normalize([record.title, record.body, record.category].join(' '));
      if (!terms.every(term => haystack.includes(term))) continue;
      if (axes.some(key => scope[key] && record.scope[key].length && !record.scope[key].includes(scope[key]))) continue;
      if (scope.subject && record.scope.subject && scope.subject !== record.scope.subject) continue;
      const missingScope = axes.filter(key => record.scope[key].length && !scope[key]);
      if (record.scope.subject && !scope.subject) missingScope.push('subject');
      candidates.push({ record, historical, missingScope, score: terms.reduce((s, term) => s + (normalize(record.title).includes(term) ? 3 : 1), 0) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.record.checkedAt.localeCompare(a.record.checkedAt) || a.record.id.localeCompare(b.record.id) || b.record.revision - a.record.revision);
  const cache = new Map();
  const results = [];
  for (const { record, historical, missingScope } of candidates.slice(0, limit)) {
    const sources = await assessSources(record, { workspaceRoot, allowedSourceRoots }, cache);
    const warnings = [];
    if (historical) warnings.push('superseded');
    if (record.status !== 'confirmed') warnings.push(record.status);
    if (sources.some(s => s.state !== 'unchanged')) warnings.push('source_requires_review');
    if (at < record.validFrom || (record.validUntil && at > record.validUntil)) warnings.push('outside_validity');
    if (missingScope.length) warnings.push('scope_requires_confirmation');
    if (!ruleCategories.has(record.category)) warnings.push('not_a_general_rule');
    if (!['observed', 'user_decision'].includes(record.assertion)) warnings.push('not_confirmed_fact_or_decision');
    results.push({ ...record, sources, historical, missingScope, warnings,
      verification: sources.every(s => s.state === 'unchanged') ? record.status : 'needs_review',
      usableAsRule: warnings.length === 0 });
  }
  return { schemaVersion: 1, query, scope, at, totalMatches: candidates.length, results };
}

/** Consumers receive rules separately from cases and unresolved evidence. No execution authorization is issued. */
export function buildContext(searchResult) {
  return { ...searchResult, rules: searchResult.results.filter(r => r.usableAsRule),
    reference: searchResult.results.filter(r => !r.usableAsRule),
    requiresReview: searchResult.results.some(r => r.warnings.some(w => w !== 'not_a_general_rule')),
    executionAuthorized: false };
}

export async function historyKnowledge(directory, id) {
  return (await loadStore(directory)).entries.find(entry => entry.id === id)?.revisions ?? [];
}
