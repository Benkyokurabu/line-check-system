import { NextResponse } from "next/server";

import { buildRosterSyncPreview } from "@/lib/notion-roster-sync";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = createSupabaseAdminClient();
    const preview = await buildRosterSyncPreview({ supabase, root: process.cwd() });
    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
