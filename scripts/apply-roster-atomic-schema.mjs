// Read-only dry run by default. --apply installs the atomic roster import function.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const envPath = path.resolve(process.argv.includes("--env") ? arg("--env") : ".env.local");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const project = new URL(env.SUPABASE_URL).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD || env.SUPABASE_DB_PASSWORD ||
  fs.readFileSync(path.join(path.dirname(envPath), "supabase で設定したパスワード.txt"), "utf8").trim().split(/\r?\n/)[0];
const hosts = [
  { host: `db.${project}.supabase.co`, port: 5432, user: "postgres" },
  { host: "aws-1-ap-northeast-1.pooler.supabase.com", port: 6543, user: `postgres.${project}` },
  { host: "aws-0-ap-northeast-1.pooler.supabase.com", port: 6543, user: `postgres.${project}` },
];
let db;
for (const host of hosts) {
  const candidate = new pg.Client({ ...host, password, database: "postgres", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try { await candidate.connect(); db = candidate; break; } catch { await candidate.end().catch(() => {}); }
}
if (!db) throw new Error("本番DBへ接続できませんでした");

try {
  const before = {
    created_at: new Date().toISOString(),
    function: (await db.query("select pg_get_functiondef(to_regprocedure('public.import_roster_from_excel_atomic(jsonb,jsonb,jsonb,jsonb)')) definition")).rows[0]?.definition ?? null,
    roster: (await db.query("select * from public.student_roster")).rows,
    enrollments: (await db.query("select * from public.student_class_enrollments")).rows,
    manifest: (await db.query("select * from public.app_settings where key='roster_excel_import_manifest'")).rows,
  };
  const backupDir = path.resolve("analysis_outputs/roster-atomic-migration");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `before_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(before), { flag: "wx", mode: 0o600 });
  const sql = fs.readFileSync(new URL("../supabase/roster_atomic_import_20261001.sql", import.meta.url), "utf8");
  await db.query("begin");
  try {
    await db.query("set local lock_timeout='5s';set local statement_timeout='30s'");
    await db.query(sql);
    const check = (await db.query("select to_regprocedure('public.import_roster_from_excel_atomic(jsonb,jsonb,jsonb,jsonb)') is not null installed, has_function_privilege('anon','public.import_roster_from_excel_atomic(jsonb,jsonb,jsonb,jsonb)','execute') anon_execute")).rows[0];
    if (!check.installed || check.anon_execute) throw new Error("関数または権限の検証に失敗しました");
    const counts = (await db.query("select (select count(*)::int from public.student_roster) roster,(select count(*)::int from public.student_class_enrollments) enrollments")).rows[0];
    if (counts.roster !== before.roster.length || counts.enrollments !== before.enrollments.length) throw new Error("既存件数が変わりました");
    const apply = process.argv.includes("--apply");
    await db.query(apply ? "commit" : "rollback");
    console.log(JSON.stringify({ applied: apply, verified: true, counts, backup: backupPath }));
  } catch (cause) { await db.query("rollback").catch(() => {}); throw cause; }
} finally { await db.end(); }
