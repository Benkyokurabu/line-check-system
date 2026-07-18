import "server-only";

import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const { messageId } = await params;
  const supabase = createSupabaseAdminClient();
  const { data: message, error } = await supabase
    .from("line_messages")
    .select("media_storage_path,media_status")
    .eq("id", messageId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!message?.media_storage_path || message.media_status !== "saved") {
    return NextResponse.json({ error: "media not available" }, { status: 404 });
  }

  const { data, error: signedUrlError } = await supabase.storage
    .from("line-message-media")
    .createSignedUrl(message.media_storage_path, 60);
  if (signedUrlError) return NextResponse.json({ error: signedUrlError.message }, { status: 500 });

  return NextResponse.redirect(data.signedUrl, 307);
}
