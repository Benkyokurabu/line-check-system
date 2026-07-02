import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseAdminClient();

  const { data: routes, error: routesError } = await supabase
    .from("ai_message_routes")
    .select(
      "id,message_id,teacher_name,confidence,route_type,reason,topic,handled_status,created_at",
    )
    .eq("handled_status", "pending")
    .order("created_at", { ascending: false });

  if (routesError) {
    return NextResponse.json({ error: routesError.message }, { status: 500 });
  }

  const messageIds = (routes ?? []).map((r) => r.message_id as string);

  const [{ data: messages, error: messagesError }, { data: aliases, error: aliasesError }] =
    await Promise.all([
      messageIds.length > 0
        ? supabase
            .from("line_messages")
            .select("id,line_user_id,text,display_name,received_at")
            .in("id", messageIds)
        : Promise.resolve({ data: [] as { id: string; line_user_id: string; text: string | null; display_name: string | null; received_at: string | null }[], error: null }),
      supabase.from("line_user_aliases").select("line_user_id,alias_name"),
    ]);

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }
  if (aliasesError) {
    return NextResponse.json({ error: aliasesError.message }, { status: 500 });
  }

  const aliasMap = Object.fromEntries(
    (aliases ?? []).map((a) => [a.line_user_id, a.alias_name]),
  );

  const messageMap = Object.fromEntries(
    (messages ?? []).map((m) => [m.id, m]),
  );

  const result = (routes ?? []).map((r) => {
    const msg = messageMap[r.message_id as string] ?? {};
    const lineUserId = (msg as { line_user_id?: string }).line_user_id ?? null;
    const displayName = (msg as { display_name?: string }).display_name ?? null;
    return {
      id: r.id,
      teacher_name: r.teacher_name,
      confidence: r.confidence,
      route_type: r.route_type,
      reason: r.reason,
      topic: r.topic,
      handled_status: r.handled_status,
      created_at: r.created_at,
      message_text: (msg as { text?: string }).text ?? null,
      display_name: (lineUserId && aliasMap[lineUserId]) ? aliasMap[lineUserId] : displayName,
      received_at: (msg as { received_at?: string }).received_at ?? null,
    };
  });

  return NextResponse.json({ routes: result });
}
