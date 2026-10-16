// Dry run rolls back by default; --apply installs only the two functions.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";

const argument = name => process.argv[process.argv.indexOf(name) + 1];
const envPath = path.resolve(process.argv.includes("--env") ? argument("--env") : ".env.local");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const project = new URL(env.SUPABASE_URL).hostname.split(".")[0];
const passwordPath = process.argv.includes("--password-file") ? argument("--password-file")
  : [path.resolve("supabase で設定したパスワード.txt"), path.resolve("../../supabase で設定したパスワード.txt")].find(file => fs.existsSync(file));
const passwords = (process.env.SUPABASE_DB_PASSWORD || env.SUPABASE_DB_PASSWORD)
  ? [process.env.SUPABASE_DB_PASSWORD || env.SUPABASE_DB_PASSWORD]
  : fs.readFileSync(passwordPath, "utf8").split(/\r?\n/).map(value => value.trim()).filter(value => value.length >= 12 && value.length <= 64 && !value.includes(":")).reverse();
let db;
for (const host of [`db.${project}.supabase.co`, "aws-1-ap-northeast-1.pooler.supabase.com", "aws-0-ap-northeast-1.pooler.supabase.com"]) {
  for (const password of passwords) {
    const client = new pg.Client({ host, port: host.startsWith("db.") ? 5432 : 6543, user: host.startsWith("db.") ? "postgres" : `postgres.${project}`,
      password, database: "postgres", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000, query_timeout: 30000 });
    try { await client.connect(); db = client; break; } catch { await client.end().catch(() => {}); }
  }
  if (db) break;
}
if (!db) throw new Error("本番DBへ接続できませんでした");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function snapshot() {
  const data = {};
  for (const table of ["line_user_aliases", "student_line_accounts", "student_line_links", "line_contact_registration_events"]) {
    data[table] = (await db.query(`select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`)).rows;
  }
  return data;
}
try {
  await db.query("begin");
  await db.query("set local lock_timeout='5s';set local statement_timeout='30s';lock table public.line_user_aliases,public.student_line_accounts,public.student_line_links,public.line_contact_registration_events in share mode");
  const before = await snapshot();
  const definitions = (await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('update_line_contact_alias','get_line_change_history')")).rows;
  const directory = path.resolve("analysis_outputs/line-change-history-migration"); fs.mkdirSync(directory, { recursive: true });
  const backup = path.join(directory, `before_${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify({ before, definitions }), { flag: "wx", mode: 0o600 });
  await db.query(fs.readFileSync(new URL("../supabase/line_change_history_20261016.sql", import.meta.url), "utf8"));
  for (const signature of ["update_line_contact_alias(text,text,boolean,text,boolean,text,boolean)", "get_line_change_history(text,uuid)"]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { allowed } = (await db.query("select has_function_privilege($1,$2,'execute') allowed", [role, signature])).rows[0];
      if (allowed !== (role === "service_role")) throw new Error("関数権限の検証に失敗しました");
    }
  }
  if (hash(before) !== hash(await snapshot())) throw new Error("既存の登録・履歴が変更されています");
  await db.query("select get_line_change_history('migration-read-only-check',null)");
  const apply = process.argv.includes("--apply");
  if (apply) await db.query("notify pgrst, 'reload schema'");
  await db.query(apply ? "commit" : "rollback");
  console.log(JSON.stringify({ applied: apply, verified: true, existingRecordsUnchanged: true, backup }));
} catch (error) { await db.query("rollback").catch(() => {}); throw error; }
finally { await db.end(); }
