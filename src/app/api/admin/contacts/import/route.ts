import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.rows)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const rows = (body.rows as unknown[]).filter(
    (r): r is { line_user_id: string; alias_name: string } =>
      typeof (r as Record<string, unknown>).line_user_id === "string" &&
      typeof (r as Record<string, unknown>).alias_name === "string" &&
      ((r as Record<string, unknown>).alias_name as string).trim() !== "",
  );

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("line_user_aliases").upsert(
    rows.map((r) => ({
      line_user_id: r.line_user_id,
      alias_name: r.alias_name.trim(),
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "line_user_id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imported: rows.length });
}
