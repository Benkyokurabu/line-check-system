import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { formatSlotLimit, getStudyRoomAvailability, getStudyRoomSlot, isValidDate } from "@/lib/self-study-room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  if (!isValidDate(date)) return errorResponse("日付を正しく指定してください。");
  try {
    return NextResponse.json(await getStudyRoomAvailability(date, url.searchParams.get("studentNumber")?.trim() ?? ""));
  } catch (error) {
    console.error("study room availability failed", error);
    return errorResponse("自習室の空き状況を取得できませんでした。", 500);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { date?: string; studentNumber?: string; seat?: number; slotIds?: string[] } | null;
  const date = body?.date?.trim() ?? "";
  const studentNumber = body?.studentNumber?.trim() ?? "";
  const seat = Number(body?.seat);
  const slotIds = [...new Set(Array.isArray(body?.slotIds) ? body.slotIds.map(String) : [])];
  if (!isValidDate(date) || !studentNumber || !Number.isInteger(seat) || seat < 1 || seat > 10 || !slotIds.length) return errorResponse("予約内容を正しく指定してください。");
  if (date < new Date().toISOString().slice(0, 10)) return errorResponse("過去の日付には予約できません。");
  const slots = slotIds.map(getStudyRoomSlot);
  if (slots.some((slot) => !slot)) return errorResponse("時間帯を正しく指定してください。");

  const supabase = createSupabaseAdminClient();
  const { data: student, error: studentError } = await supabase.from("student_roster").select("student_number,grade,student_name").eq("student_number", studentNumber).maybeSingle();
  if (studentError) return errorResponse("生徒情報を確認できませんでした。", 500);
  if (!student) return errorResponse("登録されていない学籍番号です。", 404);
  const availability = await getStudyRoomAvailability(date, studentNumber);
  const closed = new Set(availability.closedSlotIds);
  const requestedMinutes = slots.reduce((sum, slot) => sum + (slot?.minutes ?? 0), 0);
  if (slots.some((slot) => closed.has(slot!.id))) return errorResponse("使用不可の時間帯が含まれています。", 409);
  if (availability.limitMinutes && availability.studentMinutes + requestedMinutes > availability.limitMinutes) return errorResponse(`本日の予約上限は${formatSlotLimit(availability.limitMinutes)}です。`, 409);
  if (availability.reservations.some((item) => item.seat === seat && slotIds.includes(item.slot_id))) return errorResponse("選択した座席・時間帯は予約済みです。", 409);
  if (availability.reservations.some((item) => item.student_number === studentNumber && slotIds.includes(item.slot_id))) return errorResponse("同じ時間帯に複数の座席は予約できません。", 409);

  const rows = slots.map((slot) => ({ reservation_date: date, slot_id: slot!.id, start_time: slot!.start, end_time: slot!.end, seat, student_number: student.student_number, grade: student.grade, student_name: student.student_name, minutes: slot!.minutes }));
  const { data, error } = await supabase.from("study_room_reservations").insert(rows).select("*");
  if (error) {
    if (error.code === "23505") return errorResponse("同時に別の予約が入ったため、予約できませんでした。空き状況を更新してください。", 409);
    return errorResponse("予約の保存に失敗しました。", 500);
  }
  return NextResponse.json({ reservations: data }, { status: 201 });
}
