import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { userId } = await context.params;
  const lineUserId = decodeURIComponent(userId).trim();
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 30);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 30, 5), 100);
  if (!lineUserId) return NextResponse.json({ error: "LINE user ID is required" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const [messagesResult, evidenceResult, historyResult] = await Promise.all([
    supabase
      .from("line_messages")
      .select("id,display_name,direction,text,message_type,received_at,created_at,sent_by")
      .eq("line_user_id", lineUserId)
      .order("received_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("line_link_evidence")
      .select("detected_message_id,evidence_text,evidence_at,parsed_student_name,relation,review_status,reviewed_at")
      .eq("line_user_id", lineUserId)
      .maybeSingle(),
    supabase
      .from("line_contact_registration_events")
      .select("id,student_number,action,relation,alias_name,performed_by,source,created_at,evidence_message_id")
      .eq("line_user_id", lineUserId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (messagesResult.error) return NextResponse.json({ error: messagesResult.error.message }, { status: 500 });
  if (evidenceResult.error && !["42P01", "PGRST205"].includes(evidenceResult.error.code ?? "")) {
    return NextResponse.json({ error: evidenceResult.error.message }, { status: 500 });
  }
  if (historyResult.error && !["42P01", "PGRST205"].includes(historyResult.error.code ?? "")) {
    return NextResponse.json({ error: historyResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    messages: [...(messagesResult.data ?? [])].reverse(),
    identity_evidence: evidenceResult.data ?? null,
    registration_history: historyResult.data ?? [],
  });
}
