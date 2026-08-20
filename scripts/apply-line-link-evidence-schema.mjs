import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

const { Client } = pg;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function readPasswordCandidates() {
  if (process.env.SUPABASE_DB_PASSWORD) return [process.env.SUPABASE_DB_PASSWORD];
  const passwordFile = path.resolve("supabase で設定したパスワード.txt");
  if (!fs.existsSync(passwordFile)) throw new Error("SUPABASE_DB_PASSWORD or local Supabase password file is required.");
  return fs.readFileSync(passwordFile, "utf8").split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line.length >= 12 && line.length <= 64 && !line.includes(":") && !line.includes(" ")).reverse();
}

const sql = `
create table if not exists public.line_link_evidence (
  line_user_id text primary key,
  manager_line_user_id text,
  display_name text,
  manager_alias_name text,
  evidence_text text not null,
  evidence_at timestamptz,
  parsed_student_name text,
  relation text not null default 'unknown',
  source text not null default 'line_manager_first_self_introduction',
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_link_evidence_relation_check
    check (relation in ('student', 'mother', 'father', 'guardian', 'family', 'unknown'))
);

create index if not exists line_link_evidence_display_name_idx
  on public.line_link_evidence (display_name);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_line_link_evidence_updated_at'
      and tgrelid = 'public.line_link_evidence'::regclass
  ) then
    create trigger set_line_link_evidence_updated_at
      before update on public.line_link_evidence
      for each row execute function public.set_updated_at();
  end if;
end $$;
`;

async function main() {
  loadEnvFile(path.resolve(".env.local"));
  if (!process.env.SUPABASE_URL) throw new Error("SUPABASE_URL is required.");
  const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
  const hosts = [
    { host: `db.${projectRef}.supabase.co`, port: 5432, user: "postgres" },
    ...["ap-northeast-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2", "us-east-1", "us-west-1", "eu-west-1", "eu-central-1"]
      .flatMap((region) => [0, 1].flatMap((pooler) => [
        { host: `aws-${pooler}-${region}.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
        { host: `aws-${pooler}-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` },
      ])),
  ];
  const errors = [];
  for (const target of hosts) {
    for (const password of readPasswordCandidates()) {
      const client = new Client({ ...target, database: "postgres", password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 7000 });
      try {
        await client.connect();
        await client.query(sql);
        await client.end();
        console.log(JSON.stringify({ ok: true, table: "line_link_evidence", host: target.host, port: target.port }, null, 2));
        return;
      } catch (error) {
        try { await client.end(); } catch {}
        errors.push(`${target.host}:${target.port}:${error instanceof Error ? error.message : error}`);
      }
    }
  }
  throw new Error(`Could not connect to Supabase Postgres. Tried ${errors.length} candidates.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
