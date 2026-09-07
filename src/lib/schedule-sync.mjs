import { createHmac, timingSafeEqual } from "node:crypto";
import { getScheduleCloudPreview, listScheduleCloudMonths, ScheduleCloudError } from "./schedule-cloud.mjs";

export function scheduleSyncToken(key) {
  return createHmac("sha256", key).update("schedule-sync-cron-v1").digest("hex");
}
export function authorizeScheduleSync(request, key) {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${scheduleSyncToken(key)}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function scheduleSyncMonths(now = new Date()) {
  const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(now);
  const [year, n] = month.split("-").map(Number);
  return [month, new Date(Date.UTC(year, n, 1)).toISOString().slice(0, 7)];
}
export function scheduleSyncBlockers(report, now = new Date()) {
  const reasons = [];
  if (report.lessons && ["本校", "南教室"].some((campus) => !report.lessons.some((r) => r.campus === campus))) reasons.push("本校・南教室の両方の授業を読み取れていません。原本のシートを管理担当者が確認するまで反映を保留します。");
  if (report.summary.remove) reasons.push("原本に見当たらない授業があります。休講・日付変更・校舎変更を管理担当者が確認するまで、この月の反映を保留します。");
  if (report.summary.ambiguous) reasons.push("変更前後の授業を一意に対応付けできません。管理担当者による確認が必要です。");
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
  if (report.changes.some((c) => c.before?.lesson_date < today)) reasons.push("過去の日付の授業に差分があります。出欠履歴を守るため、管理担当者が確認するまで反映を保留します。");
  if (report.summary.existing && report.summary.update > Math.max(20, report.summary.existing * 0.25)) reasons.push("多数の授業が変更されています。原本の書式・内容を管理担当者が確認するまで反映を保留します。");
  return reasons;
}
async function rpc(db, name, args) {
  const result = await db.rpc(name, args);
  if (result.error) throw new ScheduleCloudError("反映中に登録情報が変わったか、保存処理に失敗しました。次の定期処理で再確認します。", 409);
  return result.data;
}
// The caller supplies a month only. Lesson data is always fetched from the trusted folder.
export async function syncSchedule(db, month, key, options = {}) {
  const now = options.now ?? new Date();
  if (!scheduleSyncMonths(now).includes(month)) throw new ScheduleCloudError("自動反映の対象は今月と翌月です。過去の月は確認のみできます。", 422);
  const runId = await rpc(db, "schedule_sync_claim", { p_month: month, p_trigger: options.trigger ?? "manual" });
  if (!runId) return { status: "busy", message: "直前の処理を実行中、または完了直後です。少し待って結果を確認してください。" };
  try {
    const months = await (options.listMonths ?? listScheduleCloudMonths)(db, key);
    if (!months.some((m) => m.month === month)) {
      const status = month === scheduleSyncMonths(now)[0] ? "error" : "waiting";
      const message = `${month} の原本がありません。「【完成版】授業日誌システム」にExcelを保存すると自動で再確認します。`;
      await rpc(db, "schedule_sync_finish", { p_run: runId, p_status: status, p_message: message });
      return { status, message };
    }
    const report = await (options.preview ?? getScheduleCloudPreview)(db, month, key, fetch, { includeSnapshot: true });
    // Avoid reading an Excel upload while the operator is still saving it.
    if (!Number.isFinite(Date.parse(report.source.modifiedAt)) || Date.parse(report.source.modifiedAt) > now.getTime() - 120000) {
      const message = "原本の更新直後です。保存が落ち着いてから次の定期処理で再確認します。";
      await rpc(db, "schedule_sync_finish", { p_run: runId, p_status: "waiting", p_message: message });
      return { status: "waiting", message };
    }
    const blockers = scheduleSyncBlockers(report, now);
    if (blockers.length) {
      const message = blockers.join(" ");
      await rpc(db, "schedule_sync_finish", { p_run: runId, p_status: "review", p_message: message, p_report: report });
      return { status: "review", message, summary: report.summary };
    }
    const result = await rpc(db, "schedule_sync_apply", { p_run: runId, p_report: report });
    return { ...result, message: result.status === "applied" ? "授業への反映が完了しました。教室画面・欠席連絡の授業選択に反映されます。" : "原本と登録済み授業は一致しています。反映済みです。" };
  } catch (error) {
    const message = error instanceof ScheduleCloudError ? error.message : "原本の取得・照合・反映に失敗しました。次の定期処理で再試行します。";
    await rpc(db, "schedule_sync_finish", { p_run: runId, p_status: "error", p_message: message }).catch(() => {});
    throw new ScheduleCloudError(message);
  }
}
