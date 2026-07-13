import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

const { Client } = pg;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function readPassword() {
  const explicit = process.env.SUPABASE_DB_PASSWORD;
  if (explicit) return explicit;

  const filePath = path.resolve("supabase で設定したパスワード.txt");
  if (!fs.existsSync(filePath)) {
    throw new Error("SUPABASE_DB_PASSWORD or local Supabase password file is required.");
  }

  const text = fs.readFileSync(filePath, "utf8").trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}

function projectRefFromUrl() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL is required.");
  return new URL(url).hostname.split(".")[0];
}

const sql = `
create table if not exists public.student_line_accounts (
  id uuid primary key default gen_random_uuid(),
  student_number text not null references public.student_roster (student_number) on delete cascade,
  line_user_id text not null,
  relation text not null default 'unknown',
  alias_name text,
  friend_display_name text,
  source text not null default 'line_manager_name_match',
  is_primary boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint student_line_accounts_relation_check
    check (relation in ('student', 'mother', 'father', 'guardian', 'family', 'unknown')),
  constraint student_line_accounts_unique
    unique (student_number, line_user_id)
);

create index if not exists student_line_accounts_student_number_idx
  on public.student_line_accounts (student_number);

create index if not exists student_line_accounts_line_user_id_idx
  on public.student_line_accounts (line_user_id);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_student_line_accounts_updated_at'
      and tgrelid = 'public.student_line_accounts'::regclass
  ) then
    create trigger set_student_line_accounts_updated_at
      before update on public.student_line_accounts
      for each row
      execute function public.set_updated_at();
  end if;
end $$;
`;

async function main() {
  loadEnvFile(path.resolve(".env.local"));
  const projectRef = projectRefFromUrl();
  const password = readPassword();
  const candidates = [
    { host: `db.${projectRef}.supabase.co`, port: 5432, user: "postgres" },
    ...[
      "ap-northeast-1",
      "ap-northeast-2",
      "ap-southeast-1",
      "ap-southeast-2",
      "us-east-1",
      "us-west-1",
      "eu-west-1",
      "eu-central-1",
    ].flatMap((region) => [
      { host: `aws-0-${region}.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
      { host: `aws-0-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` },
    ]),
  ];

  const errors = [];
  for (const candidate of candidates) {
    const client = new Client({
      ...candidate,
      database: "postgres",
      password,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 7000,
    });
    try {
      await client.connect();
      await client.query(sql);
      await client.end();
      console.log(JSON.stringify({
        ok: true,
        table: "student_line_accounts",
        host: candidate.host,
        port: candidate.port,
      }, null, 2));
      return;
    } catch (error) {
      try {
        await client.end();
      } catch {
        // Ignore close failures while trying connection candidates.
      }
      errors.push(`${candidate.host}:${candidate.port}:${error instanceof Error ? error.message : error}`);
    }
  }

  throw new Error(`Could not connect to Supabase Postgres. Tried ${errors.length} candidates.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
