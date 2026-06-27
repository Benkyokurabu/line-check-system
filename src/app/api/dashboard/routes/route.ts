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

  const { data: messages, error: messagesError } =
    messageIds.length > 0
      ? await supabase
          .from("line_messages")
          .select("id,text,display_name,received_at")
          .in("id", messageIds)
      : { data: [], error: null };

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  const messageMap = Object.fromEntries(
    (messages ?? []).map((m) => [m.id, m]),
  );

  const result = (routes ?? []).map((r) => {
    const msg = messageMap[r.message_id as string] ?? {};
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
      display_name: (msg as { display_name?: string }).display_name ?? null,
      received_at: (msg as { received_at?: string }).received_at ?? null,
    };
  });

  return NextResponse.json({ routes: result });
}
