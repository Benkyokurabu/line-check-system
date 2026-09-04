import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { STUDY_ROOM_SEATS, STUDY_ROOM_SLOTS, isValidDate } from "@/lib/self-study-room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!isValidDate(date)) return NextResponse.json({ error: "日付を正しく指定してください。" }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  const [{ data: reservations, error: reservationsError }, { data: setting, error: settingError }] = await Promise.all([
    supabase.from("study_room_reservations").select("*").eq("reservation_date", date).eq("status", "active").order("start_time").order("seat"),
    supabase.from("study_room_day_settings").select("limit_minutes,closed_slot_ids").eq("reservation_date", date).maybeSingle(),
  ]);
  if (reservationsError || settingError) return NextResponse.json({ error: "管理データを取得できませんでした。" }, { status: 500 });
  return NextResponse.json({ date, seats: STUDY_ROOM_SEATS, slots: STUDY_ROOM_SLOTS, reservations: reservations ?? [], limitMinutes: setting?.limit_minutes ?? 0, closedSlotIds: setting?.closed_slot_ids ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { date?: string; limitMinutes?: number; closedSlotIds?: string[]; cancelId?: string } | null;
  const supabase = createSupabaseAdminClient();
  if (body?.cancelId) {
    const { error } = await supabase.from("study_room_reservations").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", body.cancelId).eq("status", "active");
    return error ? NextResponse.json({ error: "キャンセルに失敗しました。" }, { status: 500 }) : NextResponse.json({ cancelled: true });
  }
  const date = body?.date?.trim() ?? "";
  const limitMinutes = Number(body?.limitMinutes ?? 0);
  const closedSlotIds = [...new Set(Array.isArray(body?.closedSlotIds) ? body.closedSlotIds.map(String) : [])];
  if (!isValidDate(date) || ![0, 90, 180, 270].includes(limitMinutes) || closedSlotIds.some((id) => !STUDY_ROOM_SLOTS.some((slot) => slot.id === id))) return NextResponse.json({ error: "設定内容を正しく指定してください。" }, { status: 400 });
  if (limitMinutes === 0 && !closedSlotIds.length) {
    await supabase.from("study_room_day_settings").delete().eq("reservation_date", date);
  } else {
    const { error } = await supabase.from("study_room_day_settings").upsert({ reservation_date: date, limit_minutes: limitMinutes, closed_slot_ids: closedSlotIds, updated_at: new Date().toISOString() });
    if (error) return NextResponse.json({ error: "設定の保存に失敗しました。" }, { status: 500 });
  }
  return NextResponse.json({ date, limitMinutes, closedSlotIds });
}
