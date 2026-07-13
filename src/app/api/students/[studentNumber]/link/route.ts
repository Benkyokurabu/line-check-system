import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ studentNumber: string }> },
) {
  const { studentNumber } = await context.params;
  const body = await request.json().catch(() => ({}));
  const lineUserId = typeof body.line_user_id === "string" ? body.line_user_id.trim() : "";

  if (!lineUserId) {
    return NextResponse.json({ error: "line_user_id is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const [{ error }, { error: accountError }] = await Promise.all([
    supabase.from("student_line_links").upsert(
      {
        student_number: studentNumber,
        line_user_id: lineUserId,
        updated_at: now,
      },
      { onConflict: "student_number" },
    ),
    supabase.from("student_line_accounts").upsert(
      {
        student_number: studentNumber,
        line_user_id: lineUserId,
        relation: "unknown",
        source: "manual",
        is_primary: true,
        updated_at: now,
      },
      { onConflict: "student_number,line_user_id" },
    ),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (accountError && accountError.code !== "42P01") {
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
  if (accountError && accountError.code !== "42P01") {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
