import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { scheduleSyncMonths } from "@/lib/schedule-sync.mjs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const db = createSupabaseAdminClient();
    const [control, heartbeat, ...months] = await Promise.all([
      db.from("schedule_sync_control").select("enabled,last_started_at,lease_until").eq("id", true).single(),
      db.from("schedule_sync_runs").select("started_at").eq("trigger", "cron").order("started_at", { ascending: false }).limit(1),
      ...scheduleSyncMonths().map((month) => db.from("schedule_sync_runs").select("id,month,trigger,status,message,started_at,finished_at,summary,source").eq("month", month).order("started_at", { ascending: false }).limit(8)),
    ]);
    if (control.error || heartbeat.error || months.some((m) => m.error)) throw new Error("status unavailable");
    const lastCron = heartbeat.data?.[0]?.started_at;
    return NextResponse.json({ enabled: control.data.enabled, stale: !lastCron || Date.parse(lastCron) < Date.now() - 20 * 60000,
      months: scheduleSyncMonths(), runs: months.flatMap((m) => m.data ?? []) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "自動反映の稼働状況を取得できませんでした。" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
