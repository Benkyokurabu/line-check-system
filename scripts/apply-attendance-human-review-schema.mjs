import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const workspaceRoot = path.resolve(process.cwd(), "..", "..");
const envFile = [path.resolve(".env.local"), path.join(workspaceRoot, ".env.local")].find(fs.existsSync);
if (!envFile) throw new Error(".env.local was not found");
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const passwordFile = path.join(path.dirname(envFile), "supabase で設定したパスワード.txt");
const password = process.env.SUPABASE_DB_PASSWORD || (fs.existsSync(passwordFile) ? fs.readFileSync(passwordFile, "utf8").trim().split(/\r?\n/)[0].trim() : "");
if (!password || !process.env.SUPABASE_URL) throw new Error("Supabase database configuration is incomplete");
const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const sql = fs.readFileSync(path.resolve("supabase", "attendance_human_review_20260924.sql"), "utf8");
const connections = [
  { host: `db.${projectRef}.supabase.co`, port: 5432, user: "postgres" },
  ...["ap-northeast-1", "ap-northeast-2", "ap-southeast-1"].flatMap((region) => [0, 1].flatMap((n) => [
    { host: `aws-${n}-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` },
    { host: `aws-${n}-${region}.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
  ])),
];
let lastError;
for (const connection of connections) {
  const client = new pg.Client({ ...connection, database: "postgres", password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 7000 });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query(sql);
    const check = await client.query("select to_regclass('public.attendance_candidate_review_audit') is not null as audit_ready, to_regprocedure('public.save_attendance_candidate_review(uuid,jsonb,jsonb,text)') is not null as save_ready");
    if (!check.rows[0]?.audit_ready || !check.rows[0]?.save_ready) throw new Error("Migration verification failed");
    await client.query("COMMIT");
    console.log("Attendance human-review schema applied and verified.");
    await client.end();
    process.exit(0);
  } catch (error) {
    lastError = error;
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}
throw new Error(`Could not apply attendance human-review schema: ${lastError?.message ?? "connection failed"}`);
