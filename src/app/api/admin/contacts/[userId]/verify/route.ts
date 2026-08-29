import { NextResponse } from "next/server";

import { normalizeVerificationTargets } from "@/lib/line-contact-registration.mjs";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId } = await context.params;
    const lineUserId = decodeURIComponent(userId).trim();
    const body = await request.json().catch(() => ({}));
    const verifiedBy = clean(body.verified_by, 100);
    const friendDisplayName = clean(body.friend_display_name, 200) || null;
    const evidenceMessageId = clean(body.evidence_message_id, 100) || null;
    const source = clean(body.source, 100) || "system_review";
    const targets = normalizeVerificationTargets(body.targets);

    if (!lineUserId) return NextResponse.json({ error: "LINE user ID is required" }, { status: 400 });
    if (!verifiedBy) return NextResponse.json({ error: "確認者名を入力してください" }, { status: 400 });
    if (!evidenceMessageId) {
      return NextResponse.json({ error: "確認に使ったLINEメッセージを選択してください" }, { status: 400 });
    }

    const { data, error } = await createSupabaseAdminClient().rpc("verify_line_contact", {
      p_line_user_id: lineUserId,
      p_targets: targets,
      p_friend_display_name: friendDisplayName,
      p_verified_by: verifiedBy,
      p_evidence_message_id: evidenceMessageId,
      p_source: source,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json(data ?? { ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
