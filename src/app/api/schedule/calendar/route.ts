import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { CalendarScheduleError, readCalendarSchedule } from "@/lib/schedule-calendar.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "https://benkyokurabu.github.io", Vary: "Origin" };

export async function GET(request: NextRequest) {
  try {
    const data = await readCalendarSchedule(createSupabaseAdminClient(), request.nextUrl.searchParams.get("month"));
    return NextResponse.json(data, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CalendarScheduleError ? error.message : "カレンダーの授業データを取得できませんでした。" },
      { status: error instanceof CalendarScheduleError ? error.status : 503, headers });
  }
}
