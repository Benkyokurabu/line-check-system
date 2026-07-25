import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { getRosterImportPreview, importRosterFromExcel } from "@/lib/roster-import-logic.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();
    const preview = await getRosterImportPreview({ supabase, root: process.cwd() });
    return NextResponse.json(preview);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const supabase = createSupabaseAdminClient();
    const result = await importRosterFromExcel({
      supabase,
      root: process.cwd(),
      force: body?.force === true,
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
