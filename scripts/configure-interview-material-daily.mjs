import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const apply = args.includes('--apply'), enable = args.includes('--enable'), disable = args.includes('--disable');
const time = option('--time'), days = option('--days');
if (enable && disable || enable && (!time || days === undefined)
  || time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
  || days !== undefined && !/^(?:[0-9]|[12][0-9]|30)$/.test(days))
  throw Error('有効化時は --time HH:MM --days 0～30 を指定してください。');
const envPath = path.resolve(option('--env') || '../../.env.local');
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).map(line => line.match(/^([A-Z0-9_]+)=(.*)$/))
  .filter(Boolean).map(match => [match[1], match[2].replace(/^["']|["']$/g, '')]));
const project = new URL(env.SUPABASE_URL).hostname.split('.')[0];
const secret = env.SUPABASE_DB_PASSWORD || fs.readFileSync(path.join(path.dirname(envPath), 'supabase で設定したパスワード.txt'), 'utf8');
const passwords = secret.split(/\r?\n/).map(value => value.trim()).filter(value => value.length >= 12 && value.length <= 64 && !value.includes(' ')).reverse();
const targets = [{ host: `db.${project}.supabase.co`, port: 5432, user: 'postgres' },
  ...[0, 1].flatMap(index => [6543, 5432].map(port => ({ host: `aws-${index}-ap-northeast-1.pooler.supabase.com`, port, user: `postgres.${project}` })))];
let db;
for (const target of targets) {
  for (const password of passwords) {
    const client = new pg.Client({ ...target, password, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    try { await client.connect(); db = client; break; } catch { await client.end().catch(() => {}); }
  }
  if (db) break;
}
if (!db) throw Error('本番DBへ接続できません。');
try {
  if (apply) {
    const definitions = (await db.query(`select pg_get_functiondef(p.oid) definition from pg_proc p where
      p.oid=to_regprocedure('public.interview_material_claim(text)') or p.oid=to_regprocedure('public.interview_material_daily_scan_claim(text)')`)).rows;
    const exists = (await db.query("select to_regclass('public.interview_material_daily_settings') table_name")).rows[0].table_name;
    const previous = exists ? (await db.query('select enabled,run_time,days_ahead,updated_at from interview_material_daily_settings where id')).rows[0] : null;
    const quoted = value => "'" + String(value).replaceAll("'", "''") + "'";
    const restore = ['begin;', ...definitions.map(row => row.definition + ';'),
      ...(previous ? [`update public.interview_material_daily_settings set enabled=${previous.enabled},run_time=${quoted(previous.run_time)}::time,days_ahead=${previous.days_ahead},updated_at=${quoted(previous.updated_at.toISOString())}::timestamptz where id;`]
        : ["-- No previous daily settings table. Leave the new scheduler disabled.", "update public.interview_material_daily_settings set enabled=false where id;"]),
      "notify pgrst,'reload schema';", 'commit;', ''].join('\n');
    const directory = path.resolve('analysis_outputs', 'daily-material-backups');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `before_daily_auto_${new Date().toISOString().replace(/[-:.]/g, '')}.sql`), restore, { flag: 'wx', mode: 0o600 });
  }
  await db.query('begin');
  await db.query("set local lock_timeout='5s';set local statement_timeout='30s'");
  await db.query(fs.readFileSync(new URL('../supabase/interview_material_daily_auto_20261007.sql', import.meta.url), 'utf8')
    .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, ''));
  const access = (await db.query("select has_table_privilege('anon','interview_material_daily_settings','update') anon, has_function_privilege('authenticated','interview_material_daily_scan_claim(text)','execute') authenticated")).rows[0];
  if (access.anon || access.authenticated) throw Error('自動作成の権限を確認してください。');
  if (enable || disable || time || days !== undefined) await db.query(`update interview_material_daily_settings
    set enabled=coalesce($1,enabled),run_time=coalesce($2::time,run_time),days_ahead=coalesce($3::integer,days_ahead),updated_at=now() where id`,
  [enable ? true : disable ? false : null, time || null, days === undefined ? null : Number(days)]);
  const settings = (await db.query('select enabled,run_time,days_ahead from interview_material_daily_settings where id')).rows[0];
  await db.query("notify pgrst,'reload schema'");
  await db.query(apply ? 'commit' : 'rollback');
  console.log(JSON.stringify({ applied: apply, rollbackVerified: !apply, settings, restricted: true }));
} catch (error) {
  await db.query('rollback').catch(() => {});
  throw Error(`自動作成設定の適用に失敗しました (${error.code || 'unknown'})`);
} finally { await db.end(); }
