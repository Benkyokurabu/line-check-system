import { NextResponse } from "next/server";

import { requireInternalToken } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!requireInternalToken(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 20, 1), 100);
  const auditId = url.searchParams.get("id");
  const lineRequestId = url.searchParams.get("line_request_id");

  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("line_messages")
    .select(
      "id,line_message_id,line_user_id,direction,message_type,text,sent_by,received_at,created_at,raw_event",
    )
    .eq("direction", "outbound")
    .not("raw_event", "is", null)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (auditId) query = query.eq("id", auditId);
  if (lineRequestId) query = query.contains("raw_event", { line_request_id: lineRequestId });

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const audits = (data ?? []).filter((row) => {
    const raw = row.raw_event as { audit_version?: number } | null;
    return raw?.audit_version === 1;
  });
  return NextResponse.json({ audits });
}
