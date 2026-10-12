import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';

const apply = process.argv.includes('--apply');
const envIndex = process.argv.indexOf('--env');
const envPath = path.resolve(envIndex >= 0 ? process.argv[envIndex + 1] : '.env.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
}
const project = new URL(env.SUPABASE_URL).hostname.split('.')[0];
const password = env.SUPABASE_DB_PASSWORD || fs.readFileSync(path.join(path.dirname(envPath), 'supabase で設定したパスワード.txt'), 'utf8').trim().split(/\r?\n/)[0];
let db;
for (const host of [`db.${project}.supabase.co`, 'aws-0-ap-northeast-1.pooler.supabase.com', 'aws-1-ap-northeast-1.pooler.supabase.com']) {
  const client = new pg.Client({ host, port: host.startsWith('db.') ? 5432 : 6543,
    user: host.startsWith('db.') ? 'postgres' : `postgres.${project}`, password, database: 'postgres',
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try { await client.connect(); db = client; break; } catch { await client.end().catch(() => {}); }
}
if (!db) throw Error('DB connection unavailable');
const migration = fs.readFileSync(new URL('../supabase/staff_persistent_session_20261012.sql', import.meta.url), 'utf8');
const original = fs.readFileSync(new URL('../supabase/staff_auth_20260905.sql', import.meta.url), 'utf8');
const body = sql => sql.match(/create or replace function public\.staff_authorize\([\s\S]*?\$\$([\s\S]*?)\$\$;/)[1].replaceAll('\r', '').trim();
const signature = 'public.staff_authorize(uuid,uuid,text,boolean)';
try {
  await db.query('begin');
  await db.query("set local lock_timeout='5s'");
  await db.query('lock table public.staff_auth_settings in share row exclusive mode');
  const current = (await db.query('select pg_get_functiondef($1::regprocedure) definition, prosrc body from pg_proc where oid=$1::regprocedure', [signature])).rows[0];
  assert.ok([body(original), body(migration)].includes(current.body.replaceAll('\r', '').trim()), 'Authorization function has independent changes; refusing overwrite');
  const settings = (await db.query('select * from public.staff_auth_settings where singleton')).rows[0];
  assert.equal(settings.enabled, true);
  const dir = path.resolve('analysis_outputs/persistent-login-backups'); fs.mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, `before_${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ at: new Date().toISOString(), settings, definition: current.definition }, null, 2));
  await db.query(migration.replace(/begin;\s*/, '').replace(/commit;\s*$/, ''));
  await db.query('update public.staff_auth_settings set persist_until_logout=true where singleton');
  const state = (await db.query('select enabled,persist_until_logout from public.staff_auth_settings where singleton')).rows[0];
  assert.equal(state.persist_until_logout, true);
  const managed = (await db.query('select count(*)::int total,count(not_after)::int explicit_expiry from auth.sessions s join public.staff_accounts a on a.auth_user_id=s.user_id where a.active')).rows[0];
  await db.query(apply ? 'commit' : 'rollback');
  console.log(JSON.stringify({ applied: apply, rollbackVerified: !apply, settings: state, managedSessions: managed, backupPath }));
} catch (error) {
  await db.query('rollback').catch(() => {});
  throw error;
} finally { await db.end(); }
