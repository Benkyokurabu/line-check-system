import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  const candidateId = new URL(request.url).searchParams.get("candidate_id");
  if (!userId.trim() || (candidateId && !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(candidateId))) {
    return NextResponse.json({ error: "対象の連絡を確認してください" }, { status: 400 });
  }
  const { data, error } = await createSupabaseAdminClient().rpc("get_line_change_history", {
    p_line_user_id: userId, p_candidate_id: candidateId,
  });
  if (error) return NextResponse.json({ error: "変更履歴を取得できませんでした" }, { status: 500 });
  return NextResponse.json({ history: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
