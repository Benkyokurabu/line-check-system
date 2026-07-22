import fs from "node:fs";
import path from "node:path";
import pg from "pg";

for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const passwordFile = path.resolve("supabase で設定したパスワード.txt");
const password = process.env.SUPABASE_DB_PASSWORD || fs.readFileSync(passwordFile, "utf8").trim().split(/\r?\n/)[0].trim();
const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const sql = fs.readFileSync(path.resolve("supabase", "attendance_schema.sql"), "utf8");
const candidates = [
  { host: `db.${projectRef}.supabase.co`, port: 5432, user: "postgres" },
  ...["ap-northeast-1", "ap-northeast-2", "ap-southeast-1"].flatMap((region) => [0, 1].flatMap((n) => [
    { host: `aws-${n}-${region}.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
    { host: `aws-${n}-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` },
  ])),
];
for (const connection of candidates) {
  const client = new pg.Client({ ...connection, database: "postgres", password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 7000 });
  try {
    await client.connect();
    await client.query(sql);
    await client.end();
    console.log(JSON.stringify({ ok: true, host: connection.host, port: connection.port }, null, 2));
    process.exit(0);
  } catch {
    await client.end().catch(() => {});
  }
}
throw new Error("Could not connect to Supabase Postgres");
