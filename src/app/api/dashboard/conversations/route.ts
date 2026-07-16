import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { canonicalTeacherName } from "@/lib/teacher-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESOLVED_KEYWORDS = [
  "ありがとう", "わかりました", "了解", "承知", "確認できました",
  "問題ない", "大丈夫です", "理解しました", "確認しました",
];

type RouteByUser = {
  routeId: string;
  teacherName: string;
  handledAt: string | null;
};

type RecentMessage = {
  id: string;
  line_user_id: string;
  direction: string;
  text: string | null;
  received_at: string | null;
  sent_by: string | null;
};

function likelyResolved(messages: { direction: string; text: string | null }[]): boolean {
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  if (!lastInbound?.text) return false;
  return RESOLVED_KEYWORDS.some((kw) => lastInbound.text!.includes(kw));
}

function parseStatus(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  return status === "done" ? "done" : "pending";
}

export async function GET(request: Request) {
  const handledStatus = parseStatus(request);
  const supabase = createSupabaseAdminClient();

  const { data: routes, error: routesErr } = await supabase
    .from("ai_message_routes")
    .select("id, message_id, teacher_name, handled_at")
    .eq("handled_status", handledStatus)
    .order(handledStatus === "done" ? "handled_at" : "created_at", { ascending: false })
    .limit(handledStatus === "done" ? 200 : 1000);

  if (routesErr) return NextResponse.json({ error: routesErr.message }, { status: 500 });

  const routeRows = routes ?? [];
  const messageIds = routeRows.map((r) => r.message_id as string);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: pivotMsgs, error: pivotErr } = messageIds.length > 0
    ? await supabase
        .from("line_messages")
        .select("id, line_user_id, display_name")
        .in("id", messageIds)
    : { data: [], error: null };

  if (pivotErr) return NextResponse.json({ error: pivotErr.message }, { status: 500 });

  const pivotMap = Object.fromEntries(
    (pivotMsgs ?? []).map((m) => [m.id as string, m as { id: string; line_user_id: string; display_name: string | null }]),
  );

  const routesByUser = new Map<string, RouteByUser[]>();
  const displayNameByUser = new Map<string, string | null>();

  for (const r of routeRows) {
    const pivot = pivotMap[r.message_id as string];
    if (!pivot) continue;
    const uid = pivot.line_user_id;
    if (!routesByUser.has(uid)) routesByUser.set(uid, []);
    routesByUser.get(uid)!.push({
      routeId: r.id as string,
      teacherName: canonicalTeacherName(r.teacher_name as string),
      handledAt: (r.handled_at as string | null) ?? null,
    });
    if (!displayNameByUser.has(uid)) displayNameByUser.set(uid, pivot.display_name);
  }

  const { data: recentOutbound, error: outboundErr } = handledStatus === "pending"
    ? await supabase
        .from("line_messages")
        .select("line_user_id, display_name")
        .eq("direction", "outbound")
        .eq("raw_event->>operation", "push")
        .gte("received_at", thirtyDaysAgo)
        .order("received_at", { ascending: false })
        .limit(500)
    : { data: [], error: null };

  if (outboundErr) return NextResponse.json({ error: outboundErr.message }, { status: 500 });

  for (const message of recentOutbound ?? []) {
    const uid = message.line_user_id as string | null;
    if (!uid) continue;
    if (!routesByUser.has(uid)) routesByUser.set(uid, []);
    if (!displayNameByUser.has(uid)) displayNameByUser.set(uid, (message.display_name as string | null) ?? null);
  }

  const uniqueUserIds = [...routesByUser.keys()];
  if (uniqueUserIds.length === 0) return NextResponse.json({ conversations: [] });

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

  const conversations = uniqueUserIds.map((uid) => {
    const userRoutes = routesByUser.get(uid) ?? [];
    const userMsgs = ((recentMsgs ?? []) as RecentMessage[]).filter((m) => m.line_user_id === uid);
    const teachers = [...new Set(userRoutes.map((r) => r.teacherName))];
    const displayName = aliasMap[uid] ?? displayNameByUser.get(uid) ?? null;
    const latestMsg = userMsgs[userMsgs.length - 1];
    const handledAts = userRoutes.map((r) => r.handledAt).filter((v): v is string => !!v);

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
      likely_resolved: userRoutes.length > 0 && likelyResolved(userMsgs),
      latest_at: (latestMsg?.received_at as string | null) ?? null,
      handled_at: handledAts.length > 0 ? handledAts.sort().at(-1) : null,
    };
  });

  conversations.sort((a, b) => {
    if (handledStatus === "done") {
      if (!a.handled_at) return 1;
      if (!b.handled_at) return -1;
      return new Date(b.handled_at).getTime() - new Date(a.handled_at).getTime();
    }
    if (a.likely_resolved !== b.likely_resolved) return a.likely_resolved ? 1 : -1;
    if (!a.latest_at) return 1;
    if (!b.latest_at) return -1;
    return new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime();
  });

  return NextResponse.json({ conversations });
}


