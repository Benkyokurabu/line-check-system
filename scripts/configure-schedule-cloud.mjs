// Operator-only bootstrap. Never prints or persists plaintext credentials.
import fs from "node:fs";
import path from "node:path";
import { createDecipheriv } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { sealScheduleConnection } from "../src/lib/schedule-cloud.mjs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const configFile = process.env.RCLONE_CONFIG ?? path.join(process.env.APPDATA, "rclone", "rclone.conf");
const sections = fs.readFileSync(configFile, "utf8").split(/^\[/m);
const section = sections.find((s) => s.startsWith("onedrive]")); if (!section) throw new Error("OneDrive接続がありません。");
const values = Object.fromEntries(section.split(/\r?\n/).flatMap((line) => { const m = line.match(/^([^=]+?)\s*=\s*(.*)$/); return m ? [[m[1].trim(), m[2]]] : []; }));
// rclone's documented public obfuscation algorithm, not a secret encryption key:
// https://github.com/rclone/rclone/blob/master/fs/config/obscure/obscure.go
function reveal(value) {
  const bytes = Buffer.from(value, "base64url");
  const key = Buffer.from("9c935b48730a554d6bfd7c63c886a92bd390198eb8128afbf4de162b8b95f638", "hex");
  const decipher = createDecipheriv("aes-256-ctr", key, bytes.subarray(0, 16));
  return Buffer.concat([decipher.update(bytes.subarray(16)), decipher.final()]).toString("utf8");
}
// Public rclone OneDrive client configuration from backend/onedrive/onedrive.go.
const clientId = values.client_id || "b15665d9-eda6-4092-8539-0eec376afd59";
const clientSecret = reveal(values.client_secret || "_JUdzh3LnKNqSPcf4Wu5fgMFIQOI8glZu_akYgR8yf6egowNBg-R");
const current = JSON.parse(values.token);
const refreshed = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", { method: "POST", signal: AbortSignal.timeout(20000), body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: current.refresh_token }) });
if (!refreshed.ok) throw new Error("OneDrive接続を更新できません。");
const token = await refreshed.json(); if (!token.access_token || !token.refresh_token) throw new Error("OneDrive接続の更新結果が不正です。");
const folder = ["デスクトップ", "【完成版】授業日誌システム"].map(encodeURIComponent).join("/");
const response = await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(values.drive_id)}/root:/${folder}?$select=id,folder`, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error("スケジュール原本フォルダを確認できません。");
const item = await response.json(); if (!item.id || !item.folder) throw new Error("原本フォルダが不正です。");
const data = { clientId, clientSecret, driveId: values.drive_id, folderId: item.id, token: { access_token: token.access_token, refresh_token: token.refresh_token, expiry: new Date(Date.now() + token.expires_in * 1000).toISOString() } };
const encrypted = sealScheduleConnection(data, process.env.SUPABASE_SECRET_KEY);
const project = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD || fs.readFileSync("supabase で設定したパスワード.txt", "utf8").trim().split(/\r?\n/)[0];
const options = [{ host: `db.${project}.supabase.co`, port: 5432, user: "postgres" }, ...["ap-northeast-1", "ap-northeast-2", "ap-southeast-1"].flatMap((r) => [0, 1].map((n) => ({ host: `aws-${n}-${r}.pooler.supabase.com`, port: 6543, user: `postgres.${project}` })))];
let connected = false;
for (const option of options) {
  const client = new pg.Client({ ...option, database: "postgres", password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try { await client.connect(); } catch { await client.end().catch(() => {}); continue; }
  try {
    await client.query("begin");
    await client.query(fs.readFileSync("supabase/schedule_cloud_connection.sql", "utf8"));
    await client.query("insert into public.schedule_cloud_connection(id, encrypted) values ('primary', $1) on conflict(id) do update set encrypted=excluded.encrypted,version=schedule_cloud_connection.version+1,updated_at=now()", [encrypted]);
    await client.query("commit"); connected = true;
  } catch { await client.query("rollback").catch(() => {}); throw new Error("クラウド接続の保存に失敗しました。"); }
  finally { await client.end(); }
  break;
}
if (!connected) throw new Error("設定保存先へ接続できませんでした。");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let check;
for (let retry = 0; retry < 5; retry++) {
  check = await db.from("schedule_cloud_connection").select("version").eq("id", "primary").single();
  if (!check.error) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (check.error) throw new Error("保存後の接続確認に失敗しました。");
console.log(JSON.stringify({ ok: true, connection: "OneDrive schedule folder", version: check.data.version, lessonsModified: false }));
