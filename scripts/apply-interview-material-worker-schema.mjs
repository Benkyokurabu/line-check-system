import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const rootEnv = path.resolve(process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : '.env.local');
const values = {};
for (const line of fs.readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
}
const project = new URL(values.SUPABASE_URL).hostname.split('.')[0];
const passwordText = values.SUPABASE_DB_PASSWORD || fs.readFileSync(path.join(path.dirname(rootEnv), 'supabase で設定したパスワード.txt'), 'utf8');
const passwords = passwordText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length >= 12 && line.length <= 64 && !line.includes(' ')).reverse();
const candidates = [
  { host: `db.${project}.supabase.co`, port: 5432, user: 'postgres' },
  ...[0, 1].flatMap(index => [6543, 5432].map(port => ({ host: `aws-${index}-ap-northeast-1.pooler.supabase.com`, port, user: `postgres.${project}` }))),
];
let db;
for (const candidate of candidates) {
  for (const password of passwords) {
    const client = new pg.Client({ ...candidate, password, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    try { await client.connect(); db = client; break; } catch { await client.end().catch(() => {}); }
  }
  if (db) break;
}
if (!db) throw Error('本番DBへ接続できません。');
const applied = process.argv.includes('--apply');
try {
  const sql = fs.readFileSync(new URL('../supabase/interview_material_worker_schema.sql', import.meta.url), 'utf8')
    .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
  await db.query('begin');
  await db.query("set local lock_timeout='5s'; set local statement_timeout='30s'");
  await db.query(sql);
  const grants = (await db.query("select has_function_privilege('anon','public.interview_material_claim(text)','execute') anon, has_function_privilege('authenticated','public.interview_material_finish(uuid,text,uuid,text,jsonb,text)','execute') authenticated")).rows[0];
  if (grants.anon || grants.authenticated) throw Error('匿名関数権限を確認してください。');
  if (applied) {
    await db.query('savepoint material_protocol_test');
    await db.query("update public.interview_material_workers set ready=true,last_seen_at=now() where id in ('primary','standby')");
    const testJob = (await db.query("insert into public.interview_material_jobs(kind,staff_code,payload) values ('preview','SCHEMA_TEST','{}'::jsonb) returning id")).rows[0];
    const claimed = (await db.query("select id,lease_token from public.interview_material_claim('primary')")).rows[0];
    if (!claimed || claimed.id !== testJob.id) throw Error('主担当の依頼取得に失敗しました。');
    if ((await db.query("select * from public.interview_material_claim('standby')")).rowCount !== 0) throw Error('予備PCが二重取得しました。');
    if (!(await db.query('select public.interview_material_renew($1,$2,$3) ok', [claimed.id, 'primary', claimed.lease_token])).rows[0].ok) throw Error('実行権限の更新に失敗しました。');
    if (!(await db.query("select public.interview_material_finish($1,'primary',$2,'completed','{}'::jsonb,null) ok", [claimed.id, claimed.lease_token])).rows[0].ok) throw Error('完了登録に失敗しました。');
    if ((await db.query("select public.interview_material_finish($1,'primary',$2,'completed','{}'::jsonb,null) ok", [claimed.id, claimed.lease_token])).rows[0].ok) throw Error('二重完了を許しました。');
    await db.query('rollback to savepoint material_protocol_test');
  }
  if (applied) {
    const directory = path.resolve('analysis_outputs/material-workers');
    fs.mkdirSync(directory, { recursive: true });
    for (const [id, priority] of [['primary', 1], ['standby', 2]]) {
      const file = path.join(directory, `${id}.json`);
      let config;
      if (fs.existsSync(file)) config = JSON.parse(fs.readFileSync(file, 'utf8'));
      else {
        config = { id, server: 'https://line-check-system.vercel.app', token: crypto.randomBytes(32).toString('hex') };
        fs.writeFileSync(file, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
      }
      await db.query(`insert into public.interview_material_workers(id,secret_hash,priority) values ($1,$2,$3)
        on conflict (id) do update set secret_hash=excluded.secret_hash,priority=excluded.priority`,
      [id, crypto.createHash('sha256').update(config.token).digest('hex'), priority]);
    }
    await db.query('commit');
  } else await db.query('rollback');
  console.log(JSON.stringify({ applied, rollbackVerified: !applied, workerIds: applied ? ['primary', 'standby'] : [], restricted: true }));
} catch (error) {
  await db.query('rollback').catch(() => {});
  throw error;
} finally { await db.end(); }
