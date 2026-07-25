import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportRow = {
  line_user_id: string;
  alias_name: string;
  group_name?: string;
};

function hasStringField(row: unknown, key: string) {
  return typeof (row as Record<string, unknown>)[key] === "string";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.rows)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const rows = (body.rows as unknown[])
    .filter(
      (row): row is ImportRow =>
        hasStringField(row, "line_user_id") &&
        hasStringField(row, "alias_name") &&
        ((row as Record<string, string>).line_user_id).trim() !== "" &&
        ((row as Record<string, string>).alias_name).trim() !== "",
    )
    .map((row) => ({
      line_user_id: row.line_user_id.trim(),
      alias_name: row.alias_name.trim(),
      group_name: typeof row.group_name === "string" ? row.group_name.trim() : undefined,
    }));

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0 });
  }

  const supabase = createSupabaseAdminClient();
  const userIds = [...new Set(rows.map((row) => row.line_user_id))];
  const { data: existingRows, error: existingError } = await supabase
    .from("line_user_aliases")
    .select("line_user_id,group_name")
    .in("line_user_id", userIds);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const existingGroupByUserId = new Map(
    (existingRows ?? []).map((row) => [row.line_user_id as string, row.group_name as string | null]),
  );
  const now = new Date().toISOString();
  const { error } = await supabase.from("line_user_aliases").upsert(
    rows.map((row) => ({
      line_user_id: row.line_user_id,
      alias_name: row.alias_name,
      group_name: row.group_name !== undefined ? row.group_name || null : existingGroupByUserId.get(row.line_user_id) ?? null,
      updated_at: now,
    })),
    { onConflict: "line_user_id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imported: rows.length });
}
