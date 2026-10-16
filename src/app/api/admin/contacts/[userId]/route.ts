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

  if (hasAlias && (!aliasName || aliasName.length > 200)) {
    return NextResponse.json({ error: "alias_name is required" }, { status: 400 });
  }
  if (!hasAlias && !hasGroup) {
    return NextResponse.json({ error: "alias_name or group_name is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.rpc("update_line_contact_alias", {
    p_line_user_id: userId, p_alias_name: aliasName, p_has_alias: hasAlias,
    p_group_name: groupName, p_has_group: hasGroup,
    p_performed_by: typeof body.performed_by === "string" ? body.performed_by.trim().slice(0, 100) : null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { userId } = await context.params;
  const supabase = createSupabaseAdminClient();
  const body = await request.json().catch(() => ({}));
  const { error } = await supabase.rpc("update_line_contact_alias", {
    p_line_user_id: userId, p_alias_name: null, p_has_alias: false, p_group_name: null, p_has_group: false,
    p_performed_by: typeof body.performed_by === "string" ? body.performed_by.trim().slice(0, 100) : null, p_delete: true,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
