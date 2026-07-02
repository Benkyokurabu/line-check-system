import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseAdminClient();

  const [{ data: users, error: usersError }, { data: aliases, error: aliasesError }] =
    await Promise.all([
      supabase
        .from("line_messages")
        .select("line_user_id, display_name")
        .not("line_user_id", "is", null),
      supabase.from("line_user_aliases").select("line_user_id, alias_name"),
    ]);

  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 });
  if (aliasesError) return NextResponse.json({ error: aliasesError.message }, { status: 500 });

  // 各 line_user_id の display_name を1つ確定（null でないものを優先）
  const userMap = new Map<string, string | null>();
  for (const row of users ?? []) {
    const existing = userMap.get(row.line_user_id);
    if (existing === undefined || (existing === null && row.display_name)) {
      userMap.set(row.line_user_id, row.display_name);
    }
  }

  const aliasMap = Object.fromEntries(
    (aliases ?? []).map((a) => [a.line_user_id, a.alias_name]),
  );

  const contacts = Array.from(userMap.entries()).map(([userId, displayName]) => ({
    line_user_id: userId,
    display_name: displayName ?? null,
    alias_name: aliasMap[userId] ?? null,
  }));

  // エイリアス登録済みを先に、次に LINE 名あり、最後に名前なし
  contacts.sort((a, b) => {
    const aLabel = a.alias_name ?? a.display_name ?? "";
    const bLabel = b.alias_name ?? b.display_name ?? "";
    return aLabel.localeCompare(bLabel, "ja");
  });

  return NextResponse.json({ contacts });
}
