import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { isStaffSameOrigin } from "@/lib/staff-auth-core.mjs";
import { staffJsonBody, staffResponse } from "@/lib/staff-auth-http";
import { validateFeedback } from "@/lib/feedback-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isStaffSameOrigin(request, process.env.STAFF_AUTH_ORIGIN)) return staffResponse({ error: "勉たんの画面から送信してください。" }, undefined, 403);
  try {
    const input = validateFeedback(await staffJsonBody(request));
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret) return staffResponse({ error: "送信機能を利用できません。" }, undefined, 503);
    const ip = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "unknown";
    const rateKey = createHmac("sha256", secret).update(ip.split(",")[0].trim()).digest("hex");
    const { data, error } = await createSupabaseAdminClient().rpc("submit_bentan_feedback", {
      p_id: input.id, p_name: input.name, p_message: input.message, p_rate_key: rateKey,
      p_sharing_preference: input.sharingPreference,
    });
    if (error) {
      if (error.message === "feedback_rate_limit") return staffResponse({ error: "送信回数が多いため、10分ほど待ってから送信してください。" }, undefined, 429);
      if (["invalid_feedback", "feedback_conflict"].includes(error.message)) return staffResponse({ error: "入力内容を確認してください。" }, undefined, 400);
      return staffResponse({ error: "送信を確認できませんでした。入力内容を残したまま再試行できます。" }, undefined, 503);
    }
    return staffResponse(data);
  } catch (error) {
    const invalid = error instanceof Error && (error.message === "invalid_feedback" || error.message === "invalid_request");
    return staffResponse({ error: invalid ? "名前と内容を入力してください（名前100文字・内容2000文字以内）。" : "送信を確認できませんでした。再試行してください。" }, undefined, invalid ? 400 : 503);
  }
}
