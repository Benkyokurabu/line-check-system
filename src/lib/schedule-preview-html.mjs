import { readSchedulePreview } from "./schedule-preview.mjs";
const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function lesson(value) {
  if (!value) return "—";
  if (Array.isArray(value)) return value.map(lesson).join("<hr>");
  return [value.lesson_date, value.start_time, `${value.campus} ${value.classroom}教室`, value.label, `担当: ${value.teacher_name || "未判定"}`].map(escape).join("<br>");
}
export function schedulePreviewHtml(input) {
  const report = readSchedulePreview(input);
  const kinds = { add: "追加", update: "変更", remove: "原本に見当たらない", ambiguous: "対応確認" };
  const labels = { existing: "現在の登録", incoming: "原本の授業", unchanged: "変更なし", ...kinds };
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(report.month)} 授業スケジュール確認</title><style>body{font-family:system-ui,sans-serif;background:#f3f6f8;color:#172c3b;margin:0;padding:24px}main{max-width:1100px;margin:auto;background:white;padding:28px;border-radius:14px}h1{font-size:26px}dl{display:flex;gap:24px;flex-wrap:wrap}dd{margin:0;font-size:24px;font-weight:bold}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #ccd7df;vertical-align:top}summary{cursor:pointer;padding:16px 0;font-weight:bold}.notice{padding:16px;background:#fff6dd;border-radius:8px}.scroll{overflow-x:auto}</style>
<main><p>勉たん ／ 授業管理</p><h1>${escape(report.month)} 授業スケジュール確認</h1>
<p class="notice">取込前の確認結果です。本番への登録・変更・削除は行っていません。</p>
<p>原本: ${escape(report.source.file)}<br>確認日時: ${escape(new Date(report.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }))}（日本時間）</p>
<dl>${Object.entries(report.summary).map(([key, n]) => `<div><dt>${escape(labels[key])}</dt><dd>${n}件</dd></div>`).join("")}</dl>
${report.warnings.length ? `<ul>${report.warnings.map((s) => `<li>${escape(s)}</li>`).join("")}</ul>` : ""}
${report.changes.length ? `<div class="scroll"><table><thead><tr><th>区分</th><th>現在の登録</th><th>原本</th><th>関連記録数</th></tr></thead><tbody>${report.changes.map((c) => `<tr><td>${escape(kinds[c.kind])}</td><td>${lesson(c.before)}</td><td>${lesson(c.after)}</td><td>${c.linkedRecords}</td></tr>`).join("")}</tbody></table></div>` : "<p>原本と登録済み授業は一致しています。</p>"}
<details><summary>原本の授業一覧（${report.lessons.length}件）</summary><div class="scroll"><table><thead><tr><th>日付</th><th>時間</th><th>校舎・教室</th><th>授業</th><th>担当</th></tr></thead><tbody>${report.lessons.map((r) => `<tr>${[r.lesson_date, r.start_time, `${r.campus} ${r.classroom}教室`, r.label, r.teacher_name || "未判定"].map((s) => `<td>${escape(s)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>
<p>確認日時点の結果です。反映前には原本と本番データを再確認します。関連記録数は人数とは異なります。</p></main></html>`;
}
