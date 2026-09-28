import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const envPath = path.resolve(process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : '../../.env.local');
const values = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
  .map(match => [match[1], match[2].replace(/^["']|["']$/g, '')]));
const project = new URL(values.SUPABASE_URL).hostname.split('.')[0];
const passwordText = values.SUPABASE_DB_PASSWORD || fs.readFileSync(path.join(path.dirname(envPath), 'supabase で設定したパスワード.txt'), 'utf8');
const passwords = passwordText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length >= 12 && line.length <= 64 && !line.includes(' ')).reverse();
const targets = [
  { host: `db.${project}.supabase.co`, port: 5432, user: 'postgres' },
  ...[0, 1].flatMap(index => [6543, 5432].map(port => ({ host: `aws-${index}-ap-northeast-1.pooler.supabase.com`, port, user: `postgres.${project}` }))),
];
let db;
for (const target of targets) {
  for (const password of passwords) {
    const client = new pg.Client({ ...target, password, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    try { await client.connect(); db = client; break; } catch { await client.end().catch(() => {}); }
  }
  if (db) break;
}
if (!db) throw Error('本番DBへ接続できません。');
const apply = process.argv.includes('--apply');
try {
  const sql = fs.readFileSync('supabase/interview_material_info_summary.sql', 'utf8').replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
  await db.query('begin');
  await db.query("set local lock_timeout='5s'; set local statement_timeout='30s'");
  await db.query(sql);
  const access = (await db.query("select has_table_privilege('anon','public.interview_material_info_summaries','select') anon, has_table_privilege('authenticated','public.interview_material_info_summaries','insert') authenticated, has_table_privilege('service_role','public.interview_material_info_summaries','select') service")).rows[0];
  if (access.anon || access.authenticated || !access.service) throw Error('要約テーブルの権限を確認してください。');
  await db.query("notify pgrst, 'reload schema'");
  await db.query(apply ? 'commit' : 'rollback');
  console.log(JSON.stringify({ applied: apply, restricted: true }));
} catch (error) {
  await db.query('rollback').catch(() => {});
  throw new Error(`要約テーブルの適用に失敗しました (${error.code || 'unknown'})`);
} finally { await db.end(); }
