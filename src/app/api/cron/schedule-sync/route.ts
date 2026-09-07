import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { getServerEnv } from "@/lib/env";
import { authorizeScheduleSync, scheduleSyncMonths, syncSchedule } from "@/lib/schedule-sync.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(request: NextRequest) {
  const key = getServerEnv().SUPABASE_SECRET_KEY;
  if (!authorizeScheduleSync(request, key)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Alternate months, keeping one Excel download within the function's time budget.
  const month = scheduleSyncMonths()[Math.floor(Date.now() / 300000) % 2];
  try {
    return NextResponse.json(await syncSchedule(createSupabaseAdminClient(), month, key, { trigger: "cron" }));
  } catch { return NextResponse.json({ error: "Schedule sync failed; see schedule status." }, { status: 503 }); }
}
