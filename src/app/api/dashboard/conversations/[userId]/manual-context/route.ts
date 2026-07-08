import "server-only";

import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const sentBy = typeof body.sent_by === "string" && body.sent_by.trim()
    ? body.sent_by.trim()
    : null;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("line_messages")
    .insert({
      line_message_id: `manual_context_${crypto.randomUUID()}`,
      line_user_id: userId,
      display_name: "AI文脈用メモ",
      message_type: "text",
      text,
      direction: "outbound",
      received_at: now,
      sent_by: sentBy ?? "AI文脈用メモ",
      raw_event: {
        source: "manual_context",
        created_by: sentBy,
      },
    })
    .select("id,line_user_id,display_name,text,received_at,sent_by")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: data });
}
