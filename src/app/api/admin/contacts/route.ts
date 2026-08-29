import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseAdminClient();

  const summaries = [];
  let summaryError = null;
  for (let from = 0; ; from += 1000) {
    const result = await supabase
      .rpc("get_line_contact_admin_summaries")
      .range(from, from + 999);
    if (result.error) {
      summaryError = result.error;
      break;
    }
    summaries.push(...(result.data ?? []));
    if (!result.data || result.data.length < 1000) break;
  }

  if (!summaryError) {
    return NextResponse.json({ contacts: summaries });
  }
  if (!["42883", "PGRST202"].includes(summaryError.code ?? "")) {
    return NextResponse.json({ error: summaryError.message }, { status: 500 });
  }

  const [{ data: users, error: usersError }, { data: aliases, error: aliasesError }] =
    await Promise.all([
      supabase
        .from("line_messages")
        .select("line_user_id, display_name")
        .not("line_user_id", "is", null),
      supabase.from("line_user_aliases").select("line_user_id, alias_name, group_name"),
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

  // A valid LINE contact may not have sent or received a message yet. Keep
  // alias-only contacts selectable so they can be linked before first contact.
  for (const alias of aliases ?? []) {
    if (!userMap.has(alias.line_user_id)) {
      userMap.set(alias.line_user_id, null);
    }
  }

  const aliasMap = Object.fromEntries(
    (aliases ?? []).map((a) => [a.line_user_id, a.alias_name]),
  );
  const groupMap = Object.fromEntries(
    (aliases ?? []).map((a) => [a.line_user_id, a.group_name]),
  );

  const contacts = Array.from(userMap.entries()).map(([userId, displayName]) => ({
    line_user_id: userId,
    display_name: displayName ?? null,
    alias_name: aliasMap[userId] ?? null,
    group_name: groupMap[userId] ?? null,
    latest_message_at: null,
    latest_text: null,
    registered_accounts: [],
    system_verified: false,
    pending_evidence: false,
    verified_by: null,
    verified_at: null,
    registration_state: "other",
  }));

  // エイリアス登録済みを先に、次に LINE 名あり、最後に名前なし
  contacts.sort((a, b) => {
    const aLabel = a.alias_name ?? a.display_name ?? "";
    const bLabel = b.alias_name ?? b.display_name ?? "";
    return aLabel.localeCompare(bLabel, "ja");
  });

  return NextResponse.json({ contacts });
}
