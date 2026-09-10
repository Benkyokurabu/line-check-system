import fs from "node:fs";
import pg from "pg";
import { randomUUID } from "node:crypto";

const apply = process.argv.includes("--apply");
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}
const project = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const passwords = process.env.SUPABASE_DB_PASSWORD ? [process.env.SUPABASE_DB_PASSWORD] :
  fs.readFileSync("supabase で設定したパスワード.txt", "utf8").split(/\r?\n/).map((row) => row.trim()).filter((row) => row.length >= 12 && row.length <= 64 && !row.includes(":")).reverse();
let client;
for (const target of [{ host: "aws-1-ap-northeast-1.pooler.supabase.com", port: 6543, user: `postgres.${project}` }, { host: `db.${project}.supabase.co`, port: 5432, user: "postgres" }]) {
  for (const password of passwords) {
    const candidate = new pg.Client({ ...target, database: "postgres", password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 7000, query_timeout: 30000 });
    try { await candidate.connect(); client = candidate; break; } catch { await candidate.end().catch(() => {}); }
  }
  if (client) break;
}
if (!client) throw new Error("Database connection unavailable");
try {
  await client.query("begin");
  await client.query("set local lock_timeout='8s'; set local statement_timeout='30s'");
  const owner = (await client.query("select id from public.staff_accounts where staff_code='KUDO' and active and auth_user_id is not null for share")).rows;
  if (owner.length !== 1) throw new Error("Owner account unavailable");
  const definitions = (await client.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('submit_bentan_feedback','list_bentan_feedback')")).rows;
  const exists = (await client.query("select to_regclass('public.bentan_feedback_reader') is not null present")).rows[0].present;
  const readerBefore = exists ? (await client.query("select * from public.bentan_feedback_reader")).rows : [];
  const countBefore = exists ? Number((await client.query("select count(*) count from public.bentan_feedback")).rows[0].count) : 0;
  fs.mkdirSync("analysis_outputs/feedback-migration", { recursive: true });
  fs.writeFileSync(`analysis_outputs/feedback-migration/before_${Date.now()}.json`, JSON.stringify({ definitions, readerBefore, countBefore }), { flag: "wx" });
  await client.query(fs.readFileSync("supabase/feedback_20260910.sql", "utf8"));
  await client.query("insert into public.bentan_feedback_reader(singleton,staff_id) values(true,$1) on conflict do nothing", [owner[0].id]);
  const reader = (await client.query("select staff_id from public.bentan_feedback_reader")).rows;
  if (reader.length !== 1 || reader[0].staff_id !== owner[0].id) throw new Error("Reader mismatch");
  const privileges = (await client.query(`select
    has_table_privilege('anon','public.bentan_feedback','select') anon_read,
    has_table_privilege('authenticated','public.bentan_feedback','select') authenticated_read,
    has_function_privilege('anon','public.list_bentan_feedback(uuid,uuid,integer)','execute') anon_list,
    has_function_privilege('authenticated','public.list_bentan_feedback(uuid,uuid,integer)','execute') authenticated_list`)).rows[0];
  if (Object.values(privileges).some(Boolean)) throw new Error("Unexpected public access");
  await client.query("savepoint feedback_check");
  const id = randomUUID();
  for (let i = 0; i < 2; i++) await client.query("select public.submit_bentan_feedback($1,'動作検証','このデータはロールバックします',$2)", [id, "f".repeat(64)]);
  if (Number((await client.query("select count(*) count from public.bentan_feedback where id=$1", [id])).rows[0].count) !== 1) throw new Error("Retry duplicated feedback");
  await client.query("rollback to savepoint feedback_check");
  if (Number((await client.query("select count(*) count from public.bentan_feedback")).rows[0].count) !== countBefore) throw new Error("Existing feedback changed");
  await client.query(apply ? "commit" : "rollback");
  console.log(JSON.stringify({ ok: true, applied: apply, onlyKudo: true, existingFeedbackUnchanged: true, testDataRolledBack: true, ...privileges }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(JSON.stringify({ ok: false, error: "Feedback migration rolled back", code: error.code ?? null }));
  process.exitCode = 1;
} finally { await client.end(); }
