import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("attendance_analysis_queue_status");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    queued: Number(row?.queued ?? 0),
    ready: Number(row?.ready ?? 0),
    processing: Number(row?.processing ?? 0),
    retry_wait: Number(row?.retry_wait ?? 0),
    dead: Number(row?.dead ?? 0),
    failed: Number(row?.dead ?? 0),
    oldest_queued_at: row?.oldest_queued_at ?? null,
    processed_last_hour: Number(row?.processed_last_hour ?? 0),
    last_worker_started_at: row?.last_worker_started_at ?? null,
    last_worker_succeeded_at: row?.last_worker_succeeded_at ?? null,
    last_worker_error: row?.last_worker_error ?? null,
    last_alert_at: row?.last_alert_at ?? null,
    alert_active: Boolean(row?.alert_active),
    last_checked_at: new Date().toISOString(),
  });
}
