import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedRelation(value: string) {
  return ["student", "mother", "father", "guardian", "family", "unknown"].includes(value)
    ? value
    : "guardian";
}
export async function PUT(
  request: Request,
  context: { params: Promise<{ studentNumber: string }> },
) {
  const { studentNumber } = await context.params;
  const body = await request.json().catch(() => ({}));
  const lineUserId = typeof body.line_user_id === "string" ? body.line_user_id.trim() : "";
  const relation = allowedRelation(typeof body.relation === "string" ? body.relation : "guardian");
  const isPrimary = typeof body.is_primary === "boolean" ? body.is_primary : relation === "student";
  const aliasName = typeof body.alias_name === "string" && body.alias_name.trim() ? body.alias_name.trim() : null;
  const friendDisplayName = typeof body.friend_display_name === "string" && body.friend_display_name.trim()
    ? body.friend_display_name.trim()
    : null;

  if (!lineUserId) {
    return NextResponse.json({ error: "line_user_id is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const linkPromise = isPrimary
    ? supabase.from("student_line_links").upsert(
        {
          student_number: studentNumber,
          line_user_id: lineUserId,
          updated_at: now,
        },
        { onConflict: "student_number" },
      )
    : Promise.resolve({ error: null });
  const [{ error }, { error: accountError }] = await Promise.all([
    linkPromise,
    supabase.from("student_line_accounts").upsert(
      {
        student_number: studentNumber,
        line_user_id: lineUserId,
        relation,
        alias_name: aliasName,
        friend_display_name: friendDisplayName,
        source: "manual",
        is_primary: isPrimary,
        updated_at: now,
      },
      { onConflict: "student_number,line_user_id" },
    ),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (accountError && !["42P01", "PGRST205"].includes(accountError.code)) {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ studentNumber: string }> },
) {
  const { studentNumber } = await context.params;
  const supabase = createSupabaseAdminClient();
  const [{ error }, { error: accountError }] = await Promise.all([
    supabase
      .from("student_line_links")
      .delete()
      .eq("student_number", studentNumber),
    supabase
      .from("student_line_accounts")
      .delete()
      .eq("student_number", studentNumber),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (accountError && !["42P01", "PGRST205"].includes(accountError.code)) {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
