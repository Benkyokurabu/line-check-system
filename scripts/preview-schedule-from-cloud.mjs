// Read-only: retrieves the cloud workbook, extracts in a temporary directory,
// reads lessons and reference counts, and creates a private review artifact.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { buildSchedulePreview, validateScheduleMonth } from "../src/lib/schedule-preview.mjs";
import { schedulePreviewHtml } from "../src/lib/schedule-preview-html.mjs";

const execute = promisify(execFile);
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
  return args[index + 1];
}
const month = validateScheduleMonth(option("--month", new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date())));
const remote = option("--remote", "onedrive:デスクトップ/【完成版】授業日誌システム");
const exporterDir = path.resolve(option("--exporter-dir", "../【完成版】授業日誌システム"));
const rclone = option("--rclone", "rclone");
const python = option("--python", "python");
const outputDir = path.resolve(option("--output-dir", "analysis_outputs/schedule-preview"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const stage = await fs.mkdtemp(path.join(os.tmpdir(), "bentan-schedule-preview-"));
async function run(file, args, cwd = stage) {
  try { return (await execute(file, args, { cwd, windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 })).stdout; }
  catch { throw new Error(`${path.basename(file)} の処理に失敗しました。接続・実行環境を確認してください。作業先: ${stage}`); }
}
const listing = await run(rclone, ["lsf", remote, "--files-only", "--max-depth", "1"]);
const [year, number] = month.split("-").map(Number);
const candidates = listing.split(/\r?\n/).filter((name) => {
  const match = name.normalize("NFKC").match(/^(\d{4})年(\d{1,2})月スケジュール\.xlsm$/);
  return match && Number(match[1]) === year && Number(match[2]) === number;
});
if (candidates.length !== 1) throw new Error(`${month} の正式な原本が${candidates.length}件あります。原本を一意に特定できないため中止しました。`);
const file = candidates[0];
if (/[\\/]/.test(file)) throw new Error("Unexpected cloud filename");
const workbook = path.join(stage, file);
await run(rclone, ["copyto", `${remote}/${file}`, workbook]);
const sourceHash = createHash("sha256").update(await fs.readFile(workbook)).digest("hex");
// -B prevents pycache changes in the existing production exporter directory.
// The old entry-point is not used: only JSON extraction is called. Its logs and
// JSON output are confined to the downloaded workbook's temporary directory.
await run(python, ["-B", "-X", "utf8", "-c",
  "import sys; sys.path.insert(0, sys.argv[1]); import export_schedule_json as e; e.export_month_schedule_json(sys.argv[2])", exporterDir, workbook]);
const items = JSON.parse(await fs.readFile(path.join(stage, `schedule_${month}.json`), "utf8"));
// Detect edits while extraction ran, including same-size workbook edits.
const recheck = path.join(stage, "source-recheck.xlsm");
await run(rclone, ["copyto", `${remote}/${file}`, recheck]);
if (createHash("sha256").update(await fs.readFile(recheck)).digest("hex") !== sourceHash) throw new Error("読み取り中に原本が更新されました。再実行してください。");
for (const line of (await fs.readFile(".env.local", "utf8").catch(() => "")).split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("本番授業データへの接続設定がありません。");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
async function readAll(table, select, filter) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const result = await filter(db.from(table).select(select)).order("id").range(offset, offset + 499);
    if (result.error) throw new Error(`${table} の読み取りに失敗しました。`);
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
    if (rows.length > 100000) throw new Error("比較件数が上限を超えました。");
  }
}
const nextMonth = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
const loadLessons = () => readAll("lessons", "id,lesson_date,start_time,grade,class_name,subject,campus,classroom,teacher_name,label,source_key,source_file,source_payload,updated_at", (q) => q.gte("lesson_date", `${month}-01`).lt("lesson_date", nextMonth));
const existing = await loadLessons();
const references = {};
for (let offset = 0; offset < existing.length; offset += 100) {
  const ids = existing.slice(offset, offset + 100).map((r) => r.id);
  for (const table of ["attendance_events", "attendance_candidates", "attendance_candidate_items"]) {
    const rows = await readAll(table, "id,lesson_id", (q) => q.in("lesson_id", ids));
    for (const row of rows) references[row.lesson_id] = (references[row.lesson_id] ?? 0) + 1;
  }
}
if (JSON.stringify(existing) !== JSON.stringify(await loadLessons())) throw new Error("比較中に本番授業データが変わりました。再実行してください。");
const preview = buildSchedulePreview(items, existing, month, references);
const report = { ...preview, generatedAt: new Date().toISOString(), source: { file, remote, sha256: sourceHash }, existing, references };
await fs.mkdir(outputDir, { recursive: true });
const output = path.join(outputDir, `schedule-preview-${month}-${stamp}.json`);
await fs.writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
const html = output.replace(/\.json$/, ".html");
await fs.writeFile(html, schedulePreviewHtml(report), { flag: "wx" });
console.log(JSON.stringify({ ok: true, applied: false, output, html, source: file, summary: preview.summary, warnings: preview.warnings }, null, 2));
