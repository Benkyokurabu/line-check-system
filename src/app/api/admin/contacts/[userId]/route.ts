import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { userId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const aliasName =
    typeof body.alias_name === "string" ? body.alias_name.trim() : "";

  if (!aliasName) {
    return NextResponse.json({ error: "alias_name is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("line_user_aliases").upsert(
    { line_user_id: userId, alias_name: aliasName, updated_at: new Date().toISOString() },
    { onConflict: "line_user_id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { userId } = await context.params;
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("line_user_aliases")
    .delete()
    .eq("line_user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
