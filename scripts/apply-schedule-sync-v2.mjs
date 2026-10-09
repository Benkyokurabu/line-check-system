// Additive, service-role-only schedule sync RPC migration.
// Default is a transaction that is rolled back. Pass --apply to commit.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const envPath = path.resolve(option('--env') ?? '.env.local');
const auditPath = option('--audit');
const apply = process.argv.includes('--apply');
const inspectOnly = process.argv.includes('--inspect');
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/u)).filter(Boolean)
  .map(match => [match[1], match[2].replace(/^["']|["']$/gu, '')]));
const project = new URL(env.SUPABASE_URL).hostname.split('.')[0];
const passwordText = env.SUPABASE_DB_PASSWORD
  || fs.readFileSync(path.join(path.dirname(envPath), 'supabase で設定したパスワード.txt'), 'utf8');
const passwords = passwordText.split(/\r?\n/).map(line => line.trim())
  .filter(line => line.length >= 12 && line.length <= 64 && !line.includes(' ')).reverse();
const targets = [
  { host: `db.${project}.supabase.co`, port: 5432, user: 'postgres' },
  ...[0, 1].flatMap(index => [6543, 5432].map(port => ({
    host: `aws-${index}-ap-northeast-1.pooler.supabase.com`, port, user: `postgres.${project}`,
  }))),
];
let db;
for (const target of targets) {
  for (const password of passwords) {
    const candidate = new pg.Client({ ...target, password, database: 'postgres',
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    try { await candidate.connect(); db = candidate; break; } catch { await candidate.end().catch(() => {}); }
  }
  if (db) break;
}
if (!db) throw Error('Existing PostgreSQL connection could not be opened');

const names = [
  'public.schedule_sync_claim(text,text)',
  'public.schedule_sync_apply(uuid,jsonb)',
  'public.schedule_sync_finish(uuid,text,text,jsonb)',
  'public.schedule_sync_apply_v2(uuid,jsonb)',
  'public.schedule_sync_finish_v2(uuid,text,text,jsonb)',
  'public.schedule_sync_v2_ready()',
];
const sha = text => createHash('sha256').update(text).digest('hex');
async function inspect() {
  const functions = {};
  for (const name of names) {
    const { rows } = await db.query(`select pg_get_functiondef(to_regprocedure($1)) definition,
      has_function_privilege('anon',to_regprocedure($1),'execute') anon,
      has_function_privilege('authenticated',to_regprocedure($1),'execute') authenticated,
      has_function_privilege('service_role',to_regprocedure($1),'execute') service`, [name]);
    const row = rows[0];
    functions[name] = row.definition ? { present: true, sha256: sha(row.definition),
      anon: row.anon, authenticated: row.authenticated, service: row.service } : { present: false };
  }
  const state = (await db.query(`select (select count(*)::int from public.lessons) lesson_count,
    (select count(*)::int from public.schedule_sync_runs) run_count,
    (select row_to_json(c) from public.schedule_sync_control c where id=true) control`)).rows[0];
  return { functions, state };
}

let inTransaction = false;
try {
  const before = await inspect();
  for (const name of names.slice(0, 3)) {
    const value = before.functions[name];
    if (!value.present || value.anon || value.authenticated || !value.service) {
      throw Error(`Legacy RPC definition or grant is unexpected: ${name}`);
    }
  }
  const installed = names.slice(3).map(name => before.functions[name].present);
  if (installed.some(Boolean) && !installed.every(Boolean)) throw Error('Only part of v2 is already installed');
  const result = { checkedAt: new Date().toISOString(), mode: inspectOnly ? 'inspect' : apply ? 'apply' : 'dry-run',
    before, migrationApplied: false };
  if (!inspectOnly && !installed.every(Boolean)) {
    const source = fs.readFileSync(new URL('../supabase/schedule_sync_v2_20261009.sql', import.meta.url), 'utf8');
    const sql = source.replace(/^begin;\r?\n/gmu, '').replace(/^commit;\r?\n/gmu, '');
    await db.query('begin'); inTransaction = true;
    await db.query("set local lock_timeout='5s'; set local statement_timeout='30s'");
    await db.query(sql);
    const after = await inspect();
    for (const name of names.slice(0, 3)) {
      if (after.functions[name].sha256 !== before.functions[name].sha256) throw Error(`Legacy RPC changed: ${name}`);
    }
    for (const name of names.slice(3)) {
      const value = after.functions[name];
      if (!value.present || value.anon || value.authenticated || !value.service) {
        throw Error(`v2 RPC grant is unexpected: ${name}`);
      }
    }
    if (JSON.stringify(after.state) !== JSON.stringify(before.state)) throw Error('Application data changed during migration');
    result.after = after;
    await db.query(apply ? 'commit' : 'rollback'); inTransaction = false;
    result.migrationApplied = apply;
  } else if (installed.every(Boolean)) {
    result.alreadyInstalled = true;
    for (const name of names.slice(3)) {
      const value = before.functions[name];
      if (value.anon || value.authenticated || !value.service) throw Error(`Existing v2 grants are unexpected: ${name}`);
    }
  }
  if (auditPath) fs.writeFileSync(path.resolve(auditPath), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ mode: result.mode, alreadyInstalled: result.alreadyInstalled ?? false,
    migrationApplied: result.migrationApplied, legacyUnchanged: result.after ? names.slice(0, 3).every(name =>
      result.after.functions[name].sha256 === result.before.functions[name].sha256) : true,
    v2Present: result.after ? names.slice(3).every(name => result.after.functions[name].present)
      : installed.every(Boolean), dataUnchanged: result.after ? JSON.stringify(result.after.state) === JSON.stringify(result.before.state) : true }));
} catch (error) {
  if (inTransaction) await db.query('rollback').catch(() => {});
  throw error;
} finally { await db.end(); }
