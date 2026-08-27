import "server-only";

import { NextResponse } from "next/server";

import { requireAttendanceCronToken } from "@/lib/env";
import { scanLineIdentityCandidates } from "@/lib/line-identity-candidate-scan";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(request: Request) {
  if (!requireAttendanceCronToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await scanLineIdentityCandidates({
      supabase: createSupabaseAdminClient(),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
