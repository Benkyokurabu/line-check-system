import { NextResponse } from "next/server";

import { loadInterviewSurveyGroups } from "@/lib/interview-surveys-notion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const groups = await loadInterviewSurveyGroups();
    return NextResponse.json({ groups, updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to refresh interview surveys from Notion", error);
    return NextResponse.json({ error: "Notionからアンケート一覧を更新できませんでした。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
