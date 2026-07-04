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
  const hasAlias = typeof body.alias_name === "string";
  const hasGroup = typeof body.group_name === "string";
  const aliasName = hasAlias ? (body.alias_name as string).trim() : "";
  const groupName = hasGroup ? (body.group_name as string).trim() : "";

  if (hasAlias && !aliasName) {
    return NextResponse.json({ error: "alias_name is required" }, { status: 400 });
  }
  if (!hasAlias && !hasGroup) {
    return NextResponse.json({ error: "alias_name or group_name is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  // 既存行を取得し、指定されたフィールドだけ更新する（片方だけの更新でもう片方を消さないため）
  const { data: existing } = await supabase
    .from("line_user_aliases")
    .select("alias_name, group_name")
    .eq("line_user_id", userId)
    .maybeSingle();

  const { error } = await supabase.from("line_user_aliases").upsert(
    {
      line_user_id: userId,
      alias_name: hasAlias ? aliasName : (existing?.alias_name ?? null),
      group_name: hasGroup ? (groupName || null) : (existing?.group_name ?? null),
      updated_at: new Date().toISOString(),
    },
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
