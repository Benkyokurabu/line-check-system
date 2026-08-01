import { NextResponse } from "next/server";

import { syncSelectedRosterStudents } from "@/lib/notion-roster-sync";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const studentNumbers = Array.isArray(body?.student_numbers) ? body.student_numbers : [];
    const supabase = createSupabaseAdminClient();
    const result = await syncSelectedRosterStudents({
      supabase,
      root: process.cwd(),
      studentNumbers,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
