// Server-side only: callers must never serialize connection or Graph responses.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { parseScheduleWorkbook } from "./schedule-excel.mjs";
import { buildSchedulePreview, validateScheduleMonth } from "./schedule-preview.mjs";

const GRAPH = "https://graph.microsoft.com/v1.0";
export class ScheduleCloudError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
const encryptionKey = (key) => {
  if (!key || key.length < 20) throw new ScheduleCloudError("クラウド接続の設定を確認してください。");
  return createHash("sha256").update(`bentan-schedule-cloud-v1:${key}`).digest();
};
export function sealScheduleConnection(value, key) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
export function openScheduleConnection(value, key) {
  try {
    const [iv, tag, body] = value.split(".").map((s) => Buffer.from(s, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), iv); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
  } catch { throw new ScheduleCloudError("クラウド接続の設定を確認してください。"); }
}
async function boundedBody(response, max = 8 * 1024 * 1024) {
  if (Number(response.headers.get("content-length")) > max) throw new ScheduleCloudError("ファイルが大きすぎます。原本を確認してください。", 422);
  const reader = response.body?.getReader(); if (!reader) throw new ScheduleCloudError("ファイルを取得できませんでした。");
  const parts = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
    if (size > max) { await reader.cancel(); throw new ScheduleCloudError("ファイルが大きすぎます。", 422); } parts.push(Buffer.from(value));
  } } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}
export function scheduleFileMonth(name) {
  const m = String(name).normalize("NFKC").match(/^(20\d{2})年(0?[1-9]|1[0-2])月スケジュール\.xlsm$/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
}
async function cloudSession(db, key, fetcher) {
  const { data: row, error } = await db.from("schedule_cloud_connection").select("encrypted,version").eq("id", "primary").single();
  if (error || !row) throw new ScheduleCloudError("OneDriveとの接続準備が完了していません。管理担当者へお知らせください。");
  const config = openScheduleConnection(row.encrypted, key);
  if (!config.driveId || !config.folderId || !config.token?.refresh_token || !config.clientId || !config.clientSecret) throw new ScheduleCloudError("OneDrive接続設定が不足しています。");
  if (!config.token.access_token || Date.parse(config.token.expiry) < Date.now() + 120000 || !Number.isFinite(Date.parse(config.token.expiry))) {
    const response = await fetcher("https://login.microsoftonline.com/common/oauth2/v2.0/token", { method: "POST", signal: AbortSignal.timeout(20000),
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: config.token.refresh_token }) });
    if (!response.ok) throw new ScheduleCloudError("OneDriveへの接続を更新できません。管理担当者による再接続が必要です。");
    const token = await response.json();
    if (!token.access_token || !token.refresh_token || !(Number(token.expires_in) > 0)) throw new ScheduleCloudError("OneDriveの接続更新に失敗しました。");
    config.token = { access_token: token.access_token, refresh_token: token.refresh_token, expiry: new Date(Date.now() + token.expires_in * 1000).toISOString() };
    const saved = await db.from("schedule_cloud_connection").update({ encrypted: sealScheduleConnection(config, key), version: row.version + 1, updated_at: new Date().toISOString() }).eq("id", "primary").eq("version", row.version);
    if (saved.error) throw new ScheduleCloudError("OneDrive接続の更新結果を保存できませんでした。");
  }
  async function graph(url) {
    if (!url.startsWith(`${GRAPH}/drives/${encodeURIComponent(config.driveId)}/`)) throw new ScheduleCloudError("OneDriveの参照先が不正です。");
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${config.token.access_token}` }, signal: AbortSignal.timeout(20000), redirect: "error", cache: "no-store" });
    if (!response.ok) throw new ScheduleCloudError(response.status === 401 ? "OneDriveの接続期限が切れています。再接続が必要です。" : "OneDriveから原本を取得できませんでした。時間をおいて再試行してください。");
    return response.json();
  }
  const base = `${GRAPH}/drives/${encodeURIComponent(config.driveId)}`;
  return { config, graph, base };
}
async function files(session) {
  let url = `${session.base}/items/${encodeURIComponent(session.config.folderId)}/children?$select=id,name,size,eTag,file,lastModifiedDateTime&$top=200`;
  const found = [];
  for (let page = 0; url && page < 50; page++) {
    const data = await session.graph(url);
    for (const item of data.value ?? []) {
      const month = scheduleFileMonth(item.name);
      if (month && item.file) found.push({ ...item, month });
    }
    url = data["@odata.nextLink"];
  }
  if (url) throw new ScheduleCloudError("原本フォルダのファイル数が上限を超えました。");
  return found;
}
export async function listScheduleCloudMonths(db, key, fetcher = fetch) {
  const list = await files(await cloudSession(db, key, fetcher));
  return list.map((f) => ({ month: f.month, file: f.name, modifiedAt: f.lastModifiedDateTime })).sort((a, b) => b.month.localeCompare(a.month));
}
async function readAll(db, table, select, filter) {
  const rows = [];
  for (let offset = 0; offset <= 100000; offset += 500) {
    const result = await filter(db.from(table).select(select)).order("id").range(offset, offset + 499);
    if (result.error) throw new ScheduleCloudError("登録済み授業・出欠情報を取得できませんでした。再試行してください。");
    rows.push(...result.data); if (result.data.length < 500) return rows;
  }
  throw new ScheduleCloudError("比較件数が上限を超えました。");
}
export async function getScheduleCloudPreview(db, month, key, fetcher = fetch) {
  validateScheduleMonth(month);
  const session = await cloudSession(db, key, fetcher);
  const candidates = (await files(session)).filter((f) => f.month === month);
  if (candidates.length !== 1) throw new ScheduleCloudError(candidates.length ? "同じ月の原本が複数あります。フォルダの原本を確認してください。" : "この月のスケジュールがフォルダにありません。Excelを保存してから再試行してください。", 422);
  const file = candidates[0];
  const metadataUrl = `${session.base}/items/${encodeURIComponent(file.id)}`;
  const before = await session.graph(metadataUrl);
  if (!before.eTag || before.eTag !== file.eTag) throw new ScheduleCloudError("原本が更新されました。もう一度確認してください。", 409);
  const download = new URL(before["@microsoft.graph.downloadUrl"] ?? "");
  if (download.protocol !== "https:" || !/(^|\.)(1drv\.com|sharepoint\.com|live\.com|microsoftpersonalcontent\.com)$/.test(download.hostname)) throw new ScheduleCloudError("原本のダウンロード先を確認できませんでした。");
  const response = await fetcher(download, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok) throw new ScheduleCloudError("Excelをダウンロードできませんでした。再試行してください。");
  const buffer = await boundedBody(response);
  let items;
  try { items = parseScheduleWorkbook(buffer, month); } catch (e) { throw new ScheduleCloudError(e instanceof Error ? e.message : "Excelを読み取れませんでした。", 422); }
  const after = await session.graph(metadataUrl);
  if (after.eTag !== before.eTag) throw new ScheduleCloudError("読み取り中に原本が更新されました。もう一度確認してください。", 409);
  const [year, number] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
  const load = () => readAll(db, "lessons", "id,lesson_date,start_time,grade,class_name,subject,campus,classroom,teacher_name,label,source_key,source_file,source_payload,updated_at", (q) => q.gte("lesson_date", `${month}-01`).lt("lesson_date", next));
  const existing = await load(); const references = {};
  for (let offset = 0; offset < existing.length; offset += 100) {
    const ids = existing.slice(offset, offset + 100).map((r) => r.id);
    const batches = await Promise.all(["attendance_events", "attendance_candidates", "attendance_candidate_items"].map((table) => readAll(db, table, "id,lesson_id", (q) => q.in("lesson_id", ids))));
    for (const row of batches.flat()) references[row.lesson_id] = (references[row.lesson_id] ?? 0) + 1;
  }
  if (JSON.stringify(existing) !== JSON.stringify(await load())) throw new ScheduleCloudError("比較中に登録済み授業が変更されました。もう一度確認してください。", 409);
  const result = buildSchedulePreview(items, existing, month, references);
  // No credentials, Graph IDs/URLs, student IDs, messages or connection metadata.
  return { ...result, generatedAt: new Date().toISOString(), source: { file: file.name, modifiedAt: before.lastModifiedDateTime, sha256: createHash("sha256").update(buffer).digest("hex") } };
}
