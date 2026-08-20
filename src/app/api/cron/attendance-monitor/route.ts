import "server-only";

import { NextResponse } from "next/server";

import { monitorAttendanceAnalysis } from "@/lib/attendance-analysis-monitor";
import { requireInternalToken } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleAttendanceMonitor(request: Request) {
  if (!requireInternalToken(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await monitorAttendanceAnalysis());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleAttendanceMonitor(request);
}

export async function POST(request: Request) {
  return handleAttendanceMonitor(request);
}
