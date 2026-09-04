import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { hidden?: unknown; changed_by?: unknown };
  if (typeof body.hidden !== "boolean") {
    return NextResponse.json({ error: "表示状態を指定してください" }, { status: 400 });
  }
  const changedBy = cleanText(body.changed_by);
  if (!changedBy) {
    return NextResponse.json({ error: "画面上部の確認者名を入力してください" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("attendance_candidates")
    .update({
      review_hidden_at: body.hidden ? new Date().toISOString() : null,
      review_hidden_by: body.hidden ? changedBy : null,
    })
    .eq("id", id)
    .select("id,review_hidden_at,review_hidden_by")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "対象の連絡が見つかりません" }, { status: 404 });
  return NextResponse.json({ candidate: data });
}
