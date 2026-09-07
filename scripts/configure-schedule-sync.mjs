// Operator-only deployment: no plaintext secrets in output or files.
import fs from "node:fs";
import pg from "pg";
import { scheduleSyncToken } from "../src/lib/schedule-sync.mjs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const project = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD || fs.readFileSync("supabase で設定したパスワード.txt", "utf8").trim().split(/\r?\n/)[0];
const options = [{ host: `db.${project}.supabase.co`, port: 5432, user: "postgres" }, ...["ap-northeast-1", "ap-northeast-2", "ap-southeast-1"].flatMap((r) => [0, 1].map((n) => ({ host: `aws-${n}-${r}.pooler.supabase.com`, port: 6543, user: `postgres.${project}` })))];
let db;
for (const option of options) {
  const candidate = new pg.Client({ ...option, database: "postgres", password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try { await candidate.connect(); db = candidate; break; } catch { await candidate.end().catch(() => {}); }
}
if (!db) throw new Error("設定保存先へ接続できませんでした。");
try {
  if (process.argv.includes("--inspect")) {
    console.log(JSON.stringify({ jobs: (await db.query("select jobname,schedule,active from cron.job where jobname='schedule-sync-worker'")).rows,
      control: (await db.query("select enabled,last_started_at,lease_until from schedule_sync_control")).rows,
      runs: (await db.query("select month,status,message,started_at,finished_at from schedule_sync_runs order by started_at desc limit 8")).rows }));
  } else {
    await db.query("begin");
    await db.query(fs.readFileSync("supabase/schedule_sync.sql", "utf8"));
    if (process.argv.includes("--enable")) {
      const token = scheduleSyncToken(process.env.SUPABASE_SECRET_KEY);
      const name = "schedule_sync_internal_token";
      const previous = (await db.query("select id from vault.secrets where name=$1", [name])).rows[0];
      if (previous) await db.query("select vault.update_secret($1::uuid,$2,$3,$4)", [previous.id, token, name, "Trusted schedule worker"]);
      else await db.query("select vault.create_secret($1,$2,$3)", [token, name, "Trusted schedule worker"]);
      const command = `select net.http_post(
        url := 'https://line-check-system.vercel.app/api/cron/schedule-sync',
        headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='schedule_sync_internal_token'),'Content-Type','application/json'),
        body := '{}'::jsonb, timeout_milliseconds := 120000);`;
      await db.query("select cron.schedule($1,$2,$3)", ["schedule-sync-worker", "*/5 * * * *", command]);
      await db.query("update schedule_sync_control set enabled=true where id=true");
    }
    if (process.argv.includes("--disable")) {
      await db.query("update schedule_sync_control set enabled=false where id=true");
      const jobs = await db.query("select jobid from cron.job where jobname='schedule-sync-worker'");
      for (const job of jobs.rows) await db.query("select cron.unschedule($1::bigint)", [job.jobid]);
    }
    await db.query("commit");
    console.log(JSON.stringify({ ok: true, enabled: (await db.query("select enabled from schedule_sync_control")).rows[0].enabled }));
  }
} catch (e) { await db.query("rollback").catch(() => {}); throw e; }
finally { await db.end(); }
