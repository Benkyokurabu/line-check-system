import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await createSupabaseAdminClient().from("app_settings").select("value")
    .in("key", ["student_import_review_excel", "student_import_review_notion", "student_import_review_selected", "student_import_review_notion_cli"]);
  if (error) return NextResponse.json({ error: "確認待ちの取得に失敗しました" }, { status: 500 });
  return NextResponse.json({ reviews: (data ?? []).map(row => row.value) }, { headers: { "Cache-Control": "no-store" } });
}
