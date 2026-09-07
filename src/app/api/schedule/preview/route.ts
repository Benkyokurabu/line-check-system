import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { getServerEnv } from "@/lib/env";
import { getScheduleCloudPreview, listScheduleCloudMonths, ScheduleCloudError } from "@/lib/schedule-cloud.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
// Match the existing classroom schedule's read-only access. No mutation endpoint.
// Deduplicate simultaneous requests and briefly cache results to protect Graph.
const pending = new Map<string, Promise<unknown>>();
const recent = new Map<string, { until: number; value: unknown }>();
export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month");
  if (month !== null && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "対象の年月を選んでください。" }, { status: 400 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "勉たんの画面から操作してください。" }, { status: 403 });
  const name = month ?? "months";
  try {
    const cached = recent.get(name);
    if (cached && cached.until > Date.now()) return NextResponse.json(cached.value, { headers: { "Cache-Control": "no-store" } });
    let promise = pending.get(name);
    if (!promise) {
      const db = createSupabaseAdminClient(); const key = getServerEnv().SUPABASE_SECRET_KEY;
      promise = month ? getScheduleCloudPreview(db, month, key) : listScheduleCloudMonths(db, key).then((months) => ({ months }));
      pending.set(name, promise);
    }
    const value = await promise;
    for (const [k, v] of recent) if (v.until <= Date.now()) recent.delete(k);
    if (recent.size < 24) recent.set(name, { until: Date.now() + 15000, value });
    return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ScheduleCloudError ? e.message : "スケジュールを確認できませんでした。少し待って再試行してください。" }, { status: e instanceof ScheduleCloudError ? e.status : 503, headers: { "Cache-Control": "no-store" } });
  } finally { pending.delete(name); }
}
