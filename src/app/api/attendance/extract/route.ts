import "server-only";

import { NextResponse } from "next/server";
import { processPendingAttendanceMessages } from "@/lib/attendance-ai-extraction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await processPendingAttendanceMessages({ limit: body.limit, lookbackMinutes: body.lookback_minutes });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
