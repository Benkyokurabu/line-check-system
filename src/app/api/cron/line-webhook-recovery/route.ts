import "server-only";

import { NextResponse } from "next/server";

import { requireAttendanceCronToken } from "@/lib/env";
import { processSavedLineMessages, type SavedInboundMessage } from "@/lib/line-webhook-postprocess";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!requireAttendanceCronToken(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) return NextResponse.json({ error: "LINE token missing" }, { status: 503 });
  try {
    const supabase = createSupabaseAdminClient();
    const columns = "id,line_message_id,line_user_id,display_name,text,message_type,media_file_name,media_status";
    const [profiles, media] = await Promise.all([
      supabase.from("line_messages").select(columns).eq("direction", "inbound").is("display_name", null)
        .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("created_at").limit(100),
      supabase.from("line_messages").select(columns).eq("direction", "inbound")
        .in("media_status", ["pending", "failed"]).order("created_at").limit(100),
    ]);
    if (profiles.error || media.error) throw profiles.error ?? media.error;
    const rows = [...new Map([...(profiles.data ?? []), ...(media.data ?? [])]
      .map((row) => [row.id, row as SavedInboundMessage])).values()];
    const result = await processSavedLineMessages(supabase, rows, accessToken);
    const [remainingProfiles, remainingMedia] = await Promise.all([
      supabase.from("line_messages").select("id", { count: "exact", head: true }).eq("direction", "inbound")
        .is("display_name", null).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
      supabase.from("line_messages").select("id", { count: "exact", head: true }).eq("direction", "inbound")
        .in("media_status", ["pending", "failed"]),
    ]);
    if (remainingProfiles.error || remainingMedia.error) throw remainingProfiles.error ?? remainingMedia.error;
    const summary = { ...result, remainingProfiles: remainingProfiles.count ?? 0, remainingMedia: remainingMedia.count ?? 0 };
    if (summary.remainingMedia > 0) console.error("LINE media remains unprocessed", summary);
    return NextResponse.json(summary);
  } catch (cause) {
    console.error("LINE webhook recovery failed", cause);
    return NextResponse.json({ error: "LINE webhook recovery failed" }, { status: 503 });
  }
}
