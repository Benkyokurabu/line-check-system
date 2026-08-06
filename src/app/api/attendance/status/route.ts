import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseAdminClient();
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data, error } = await supabase.rpc("attendance_analysis_status", { p_since: since });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    queued: Number(row?.queued ?? 0),
    processing: Number(row?.processing ?? 0),
    failed: Number(row?.failed ?? 0),
    last_checked_at: new Date().toISOString(),
  });
}
