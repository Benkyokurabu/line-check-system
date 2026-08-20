import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function loadEnv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

loadEnv(path.resolve(".env.local"));
loadEnv(path.resolve(argument("--env-file", ".env.attendance-production.local")));

const appUrl = argument("--app-url", "https://line-check-system.vercel.app").replace(/\/$/, "");
const inspectOnly = process.argv.includes("--inspect");
const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
const internalToken = supabaseSecret
  ? crypto.createHmac("sha256", supabaseSecret).update("attendance-analysis-cron-v1").digest("hex")
  : null;
if (!internalToken && !inspectOnly) throw new Error("SUPABASE_SECRET_KEY is required");

const passwordFile = path.resolve("supabase で設定したパスワード.txt");
const password = process.env.SUPABASE_DB_PASSWORD
  || fs.readFileSync(passwordFile, "utf8").trim().split(/\r?\n/)[0].trim();
const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const candidates = [
  { host: `db.${projectRef}.supabase.co`, port: 5432, user: "postgres" },
  ...["ap-northeast-1", "ap-northeast-2", "ap-southeast-1"].flatMap((region) => [0, 1].flatMap((n) => [6543, 5432].map((port) => ({
    host: `aws-${n}-${region}.pooler.supabase.com`, port, user: `postgres.${projectRef}`,
  })))),
];

async function connect() {
  const failures = [];
  for (const connection of candidates) {
    const client = new pg.Client({
      ...connection,
      database: "postgres",
      password,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 7000,
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      failures.push({
        host: connection.host,
        port: connection.port,
        code: error instanceof Error && "code" in error ? error.code : null,
        message: error instanceof Error ? error.message : String(error),
      });
      await client.end().catch(() => {});
    }
  }
  throw new Error(`Could not connect to Supabase Postgres: ${JSON.stringify(failures)}`);
}

async function upsertVaultSecret(client, name, value, description) {
  const existing = await client.query("select id from vault.secrets where name = $1", [name]);
  if (existing.rows[0]?.id) {
    await client.query(
      "select vault.update_secret($1::uuid, $2, $3, $4)",
      [existing.rows[0].id, value, name, description],
    );
  } else {
    await client.query("select vault.create_secret($1, $2, $3)", [value, name, description]);
  }
}

const workerCommand = `
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'attendance_app_url') || '/api/cron/attendance-extract?limit=1',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'attendance_internal_token'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
`;

const monitorCommand = `
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'attendance_app_url') || '/api/cron/attendance-monitor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'attendance_internal_token'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
`;

const client = await connect();
try {
  if (inspectOnly) {
    const result = await client.query(`
      select
        jobs.jobname,
        jobs.schedule,
        jobs.active,
        runs.status as last_run_status,
        runs.return_message as last_return_message,
        runs.start_time as last_started_at,
        runs.end_time as last_finished_at
      from cron.job as jobs
      left join lateral (
        select details.status, details.return_message, details.start_time, details.end_time
        from cron.job_run_details as details
        where details.jobid = jobs.jobid
        order by details.start_time desc
        limit 1
      ) as runs on true
      where jobs.jobname like 'attendance-analysis-%'
      order by jobs.jobname
    `);
    const responses = await client.query(`
      select
        id,
        status_code,
        timed_out,
        error_msg,
        created,
        left(content::text, 500) as response_excerpt
      from net._http_response
      order by created desc
      limit 10
    `);
    console.log(JSON.stringify({ ok: true, jobs: result.rows, recent_http_responses: responses.rows }, null, 2));
    process.exitCode = 0;
  } else {
  await client.query("create extension if not exists pg_cron with schema pg_catalog");
  await client.query("create extension if not exists pg_net with schema extensions");
  await upsertVaultSecret(client, "attendance_app_url", appUrl, "Production URL for attendance analysis scheduler");
  await upsertVaultSecret(client, "attendance_internal_token", internalToken, "Bearer token for attendance analysis scheduler");

  for (const jobName of ["attendance-analysis-worker", "attendance-analysis-monitor"]) {
    const jobs = await client.query("select jobid from cron.job where jobname = $1", [jobName]);
    for (const job of jobs.rows) await client.query("select cron.unschedule($1::bigint)", [job.jobid]);
  }
  await client.query("select cron.schedule($1, $2, $3)", ["attendance-analysis-worker", "* * * * *", workerCommand]);
  await client.query("select cron.schedule($1, $2, $3)", ["attendance-analysis-monitor", "*/5 * * * *", monitorCommand]);

  const result = await client.query(
    "select jobname, schedule, active from cron.job where jobname like 'attendance-analysis-%' order by jobname",
  );
  console.log(JSON.stringify({ ok: true, app_url: appUrl, jobs: result.rows }, null, 2));
  }
} finally {
  await client.end();
}
