import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase";

type AttendanceQueueStatus = {
  queued: number;
  ready: number;
  processing: number;
  retry_wait: number;
  dead: number;
  oldest_queued_at: string | null;
  processed_last_hour: number;
  last_worker_started_at: string | null;
  last_worker_succeeded_at: string | null;
  last_worker_error: string | null;
  last_alert_at: string | null;
  alert_active: boolean;
};

const STALE_AFTER_MS = 10 * 60_000;
const ALERT_REPEAT_MS = 60 * 60_000;

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateAge(value: string | null, now: number) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? now - timestamp : null;
}

async function postTeamsAlert(text: string) {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) throw new Error("TEAMS_WEBHOOK_URL is not configured");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`Teams webhook failed: ${response.status}`);
}

export async function monitorAttendanceAnalysis() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("attendance_analysis_queue_status");
  if (error) throw error;
  const raw = (Array.isArray(data) ? data[0] : data) ?? {};
  const status: AttendanceQueueStatus = {
    queued: numberValue(raw.queued),
    ready: numberValue(raw.ready),
    processing: numberValue(raw.processing),
    retry_wait: numberValue(raw.retry_wait),
    dead: numberValue(raw.dead),
    oldest_queued_at: raw.oldest_queued_at ?? null,
    processed_last_hour: numberValue(raw.processed_last_hour),
    last_worker_started_at: raw.last_worker_started_at ?? null,
    last_worker_succeeded_at: raw.last_worker_succeeded_at ?? null,
    last_worker_error: raw.last_worker_error ?? null,
    last_alert_at: raw.last_alert_at ?? null,
    alert_active: Boolean(raw.alert_active),
  };

  const now = Date.now();
  const reasons: Array<{ key: string; text: string }> = [];
  const oldestAge = dateAge(status.oldest_queued_at, now);
  const workerAge = dateAge(status.last_worker_succeeded_at, now);

  if (status.dead > 0) {
    reasons.push({ key: "dead", text: `再試行上限: ${status.dead}件` });
  }
  if (status.queued > 0 && oldestAge !== null && oldestAge > STALE_AFTER_MS) {
    reasons.push({
      key: "backlog",
      text: `解析待ち: ${status.queued}件（最古 ${status.oldest_queued_at}）`,
    });
  }
  if (status.last_worker_started_at && (!status.last_worker_succeeded_at || (workerAge !== null && workerAge > STALE_AFTER_MS))) {
    reasons.push({
      key: "worker",
      text: `最終正常実行: ${status.last_worker_succeeded_at ?? "なし"}`,
    });
  }

  const alertKey = reasons.map((reason) => reason.key).sort().join("|");
  const lastAlertAge = dateAge(status.last_alert_at, now);
  const shouldRepeat = lastAlertAge === null || lastAlertAge > ALERT_REPEAT_MS;

  if (reasons.length > 0 && (!status.alert_active || shouldRepeat)) {
    await postTeamsAlert([
      "【勉たん】LINE出欠解析に滞留または停止を検知しました",
      "",
      ...reasons.map((reason) => `・${reason.text}`),
      status.last_worker_error ? `・最終エラー: ${status.last_worker_error}` : null,
      `・直近1時間の処理: ${status.processed_last_hour}件`,
    ].filter(Boolean).join("\n"));
    const { error: updateError } = await supabase.from("attendance_analysis_runtime").update({
      alert_active: true,
      last_alert_at: new Date(now).toISOString(),
      last_alert_key: alertKey,
      updated_at: new Date(now).toISOString(),
    }).eq("singleton", true);
    if (updateError) throw updateError;
    return { ok: true, alerted: true, recovered: false, status };
  }

  if (reasons.length === 0 && status.alert_active) {
    await postTeamsAlert([
      "【勉たん】LINE出欠解析は正常状態に復旧しました",
      "",
      `直近1時間の処理: ${status.processed_last_hour}件`,
    ].join("\n"));
    const { error: updateError } = await supabase.from("attendance_analysis_runtime").update({
      alert_active: false,
      last_alert_key: null,
      updated_at: new Date(now).toISOString(),
    }).eq("singleton", true);
    if (updateError) throw updateError;
    return { ok: true, alerted: false, recovered: true, status };
  }

  return { ok: true, alerted: false, recovered: false, status };
}
