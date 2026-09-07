import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { getServerEnv } from "@/lib/env";
import { syncSchedule } from "@/lib/schedule-sync.mjs";
import { ScheduleCloudError } from "@/lib/schedule-cloud.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
// Wake up the same constrained trusted-folder worker used by cron. No uploaded plan,
// arbitrary lessons, approvals, deletions or credential changes are accepted here.
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "勉たんの画面から操作してください。" }, { status: 403 });
  try {
    const result = await syncSchedule(createSupabaseAdminClient(), request.nextUrl.searchParams.get("month"), getServerEnv().SUPABASE_SECRET_KEY);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ScheduleCloudError ? e.message : "自動反映に接続できませんでした。再試行してください。" }, { status: e instanceof ScheduleCloudError ? e.status : 503 });
  }
}
