import "server-only";

import { NextResponse } from "next/server";
import { requireAttendanceCronToken } from "@/lib/env";
import { processPendingAttendanceMessages } from "@/lib/attendance-ai-extraction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleAttendanceExtraction(request: Request) {
  if (!requireAttendanceCronToken(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const limit = new URL(request.url).searchParams.get("limit") ?? 10;
    const result = await processPendingAttendanceMessages({ limit });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleAttendanceExtraction(request);
}

export async function POST(request: Request) {
  return handleAttendanceExtraction(request);
}
