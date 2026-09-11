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
 await client.query('begin');
 await client.query("set local lock_timeout='8s'; set local statement_timeout='30s'");
 const before=(await client.query('select * from public.bentan_feedback order by id')).rows;
 const reader=(await client.query('select * from public.bentan_feedback_reader')).rows;
 const definitions=(await client.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('submit_bentan_feedback','list_bentan_feedback')")).rows;
 const dir='analysis_outputs/feedback-sharing-migration';fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(`${dir}/before_${Date.now()}.json`,JSON.stringify({before,reader,definitions}),{flag:'wx'});
 await client.query(fs.readFileSync('supabase/feedback_sharing_20260911.sql','utf8'));
 const after=(await client.query('select * from public.bentan_feedback order by id')).rows;
 if(after.length!==before.length||after.some((row,i)=>Object.keys(before[i]).some(key=>JSON.stringify(row[key])!==JSON.stringify(before[i][key]))))throw new Error('Existing data changed');
 if(JSON.stringify(reader)!==JSON.stringify((await client.query('select * from public.bentan_feedback_reader')).rows))throw new Error('Reader changed');
 const privileges=(await client.query("select has_function_privilege('anon','submit_bentan_feedback(uuid,text,text,text,text)','execute') anon_submit,has_function_privilege('authenticated','submit_bentan_feedback(uuid,text,text,text,text)','execute') authenticated_submit,has_table_privilege('anon','bentan_feedback','select') anon_read,has_table_privilege('authenticated','bentan_feedback','select') authenticated_read")).rows[0];
 if(Object.values(privileges).some(Boolean))throw new Error('Public access changed');
 await client.query('savepoint feedback_sharing_test');
 for(const preference of ['anonymous','named']){
  const id=randomUUID();const key=randomUUID().replaceAll('-','').repeat(2);
  for(let i=0;i<2;i++)await client.query("select public.submit_bentan_feedback($1,'検証・保存しない','ロールバックする検証',$2,$3)",[id,key,preference]);
  const saved=(await client.query('select sharing_preference from bentan_feedback where id=$1',[id])).rows;
  if(saved.length!==1||saved[0].sharing_preference!==preference)throw new Error('Preference not saved');
 }
 await client.query('rollback to savepoint feedback_sharing_test');
 if(Number((await client.query('select count(*) count from public.bentan_feedback')).rows[0].count)!==before.length)throw new Error('Test records remain');
 await client.query(apply?'commit':'rollback');
 console.log(JSON.stringify({ok:true,applied:apply,existingFeedbackUnchanged:true,readerUnchanged:true,testDataRolledBack:true,...privileges}));
} catch(error){
 await client.query('rollback').catch(()=>{});
 console.error(JSON.stringify({ok:false,error:'Feedback sharing migration rolled back',code:error.code??null}));process.exitCode=1;
} finally {await client.end();}
