import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const body = await request.json().catch(() => ({}));
  const { handled_status } = body as { handled_status?: string };

  if (!["done", "dismissed"].includes(handled_status ?? "")) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from("ai_message_routes")
    .update({
      handled_status,
      handled_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
