import { NextResponse } from "next/server";

import { requireInternalToken } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchDisplayName(
  userId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { displayName?: string };
    return typeof data.displayName === "string" ? data.displayName : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!requireInternalToken(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
  if (!accessToken) {
    return NextResponse.json(
      { error: "LINE_CHANNEL_ACCESS_TOKEN not configured" },
      { status: 500 },
    );
  }

  const supabase = createSupabaseAdminClient();

  const { data: rows, error } = await supabase
    .from("line_messages")
    .select("id,line_user_id")
    .is("display_name", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const uniqueUserIds = [...new Set((rows ?? []).map((r) => r.line_user_id as string))];

  const profiles = await Promise.all(
    uniqueUserIds.map(async (userId) => {
      const name = await fetchDisplayName(userId, accessToken);
      return [userId, name] as [string, string | null];
    }),
  );
  const profileMap = Object.fromEntries(profiles);

  let updated = 0;
  for (const userId of uniqueUserIds) {
    const name = profileMap[userId];
    if (!name) continue;
    const { error: updateError } = await supabase
      .from("line_messages")
      .update({ display_name: name })
      .eq("line_user_id", userId)
      .is("display_name", null);
    if (!updateError) updated++;
  }

  return NextResponse.json({
    total_null: rows?.length ?? 0,
    unique_users: uniqueUserIds.length,
    updated_users: updated,
  });
}
