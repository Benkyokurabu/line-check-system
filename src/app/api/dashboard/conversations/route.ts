import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESOLVED_KEYWORDS = [
  "ありがとう", "わかりました", "了解", "承知", "確認できました",
  "問題ない", "大丈夫です", "理解しました", "確認しました",
];

function likelyResolved(messages: { direction: string; text: string | null }[]): boolean {
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  if (!lastInbound?.text) return false;
  return RESOLVED_KEYWORDS.some((kw) => lastInbound.text!.includes(kw));
}

export async function GET() {
  const supabase = createSupabaseAdminClient();

  // 1. pending な ai_message_routes を取得
  const { data: routes, error: routesErr } = await supabase
    .from("ai_message_routes")
    .select("id, message_id, teacher_name")
    .eq("handled_status", "pending");

  if (routesErr) return NextResponse.json({ error: routesErr.message }, { status: 500 });
  if (!routes || routes.length === 0) return NextResponse.json({ conversations: [] });

  const messageIds = routes.map((r) => r.message_id as string);

  // 2. message_id → line_user_id の対応と display_name を取得
  const { data: pivotMsgs, error: pivotErr } = await supabase
    .from("line_messages")
    .select("id, line_user_id, display_name")
    .in("id", messageIds);

  if (pivotErr) return NextResponse.json({ error: pivotErr.message }, { status: 500 });

  const pivotMap = Object.fromEntries(
    (pivotMsgs ?? []).map((m) => [m.id as string, m as { id: string; line_user_id: string; display_name: string | null }]),
  );

  // 3. ユーザーごとに pending route を集約
  const routesByUser = new Map<string, { routeId: string; teacherName: string }[]>();
  const displayNameByUser = new Map<string, string | null>();

  for (const r of routes) {
    const pivot = pivotMap[r.message_id as string];
    if (!pivot) continue;
    const uid = pivot.line_user_id;
    if (!routesByUser.has(uid)) routesByUser.set(uid, []);
    routesByUser.get(uid)!.push({ routeId: r.id as string, teacherName: r.teacher_name as string });
    if (!displayNameByUser.has(uid)) displayNameByUser.set(uid, pivot.display_name);
  }

  const uniqueUserIds = [...routesByUser.keys()];
  if (uniqueUserIds.length === 0) return NextResponse.json({ conversations: [] });

  // 4. 対象ユーザーの直近 30 日のメッセージ（送受信両方）を取得
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: recentMsgs, error: msgsErr }, { data: aliases, error: aliasesErr }] =
    await Promise.all([
      supabase
        .from("line_messages")
        .select("id, line_user_id, direction, text, received_at, sent_by")
        .in("line_user_id", uniqueUserIds)
        .gte("received_at", thirtyDaysAgo)
        .order("received_at", { ascending: true }),
      supabase
        .from("line_user_aliases")
        .select("line_user_id, alias_name")
        .in("line_user_id", uniqueUserIds),
    ]);

  if (msgsErr) return NextResponse.json({ error: msgsErr.message }, { status: 500 });
  if (aliasesErr) return NextResponse.json({ error: aliasesErr.message }, { status: 500 });

  const aliasMap = Object.fromEntries(
    (aliases ?? []).map((a) => [a.line_user_id as string, a.alias_name as string]),
  );

  // 5. 会話オブジェクトを組み立て
  const conversations = uniqueUserIds.map((uid) => {
    const userRoutes = routesByUser.get(uid) ?? [];
    const userMsgs = (recentMsgs ?? []).filter((m) => m.line_user_id === uid);
    const teachers = [...new Set(userRoutes.map((r) => r.teacherName))];
    const displayName = aliasMap[uid] ?? displayNameByUser.get(uid) ?? null;
    const latestMsg = userMsgs[userMsgs.length - 1];

    return {
      line_user_id: uid,
      display_name: displayName,
      teachers,
      pending_route_ids: userRoutes.map((r) => r.routeId),
      messages: userMsgs.map((m) => ({
        id: m.id as string,
        direction: m.direction as "inbound" | "outbound",
        text: m.text as string | null,
        received_at: m.received_at as string | null,
        sent_by: (m.sent_by as string | null) ?? null,
      })),
      likely_resolved: likelyResolved(userMsgs),
      latest_at: (latestMsg?.received_at as string | null) ?? null,
    };
  });

  // 未解決を先に、次に最新順
  conversations.sort((a, b) => {
    if (a.likely_resolved !== b.likely_resolved) return a.likely_resolved ? 1 : -1;
    if (!a.latest_at) return 1;
    if (!b.latest_at) return -1;
    return new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime();
  });

  return NextResponse.json({ conversations });
}
