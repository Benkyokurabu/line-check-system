import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const STUDY_ROOM_SEATS = Array.from({ length: 10 }, (_, index) => index + 1);
export const STUDY_ROOM_SLOTS = [
  { id: "14:55-16:25", start: "14:55", end: "16:25", label: "14:55-16:25", minutes: 90 },
  { id: "16:45-18:15", start: "16:45", end: "18:15", label: "16:45-18:15", minutes: 90 },
  { id: "18:35-20:05", start: "18:35", end: "20:05", label: "18:35-20:05", minutes: 90 },
  { id: "20:25-21:55", start: "20:25", end: "21:55", label: "20:25-21:55", minutes: 90 },
] as const;

export type StudyRoomReservation = {
  id: string;
  reservation_date: string;
  slot_id: string;
  start_time: string;
  end_time: string;
  seat: number;
  student_number: string;
  grade: string;
  student_name: string;
  minutes: number;
  status: "active" | "cancelled";
  created_at: string;
  cancelled_at: string | null;
};

export function getStudyRoomSlot(slotId: string) {
  return STUDY_ROOM_SLOTS.find((slot) => slot.id === slotId) ?? null;
}

export function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function formatSlotLimit(minutes: number) {
  return `1人${Math.floor(minutes / 90)}枠まで`;
}

export async function getStudyRoomAvailability(date: string, studentNumber = "") {
  const supabase = createSupabaseAdminClient();
  const [{ data: reservations, error: reservationsError }, { data: setting, error: settingError }] = await Promise.all([
    supabase.from("study_room_reservations").select("*").eq("reservation_date", date).eq("status", "active").order("start_time").order("seat"),
    supabase.from("study_room_day_settings").select("limit_minutes,closed_slot_ids").eq("reservation_date", date).maybeSingle(),
  ]);
  if (reservationsError) throw reservationsError;
  if (settingError) throw settingError;
  const activeReservations = (reservations ?? []) as StudyRoomReservation[];
  const limitMinutes = setting?.limit_minutes ?? 0;
  const studentMinutes = activeReservations.filter((item) => item.student_number === studentNumber).reduce((sum, item) => sum + item.minutes, 0);
  return {
    date,
    seats: STUDY_ROOM_SEATS,
    slots: STUDY_ROOM_SLOTS,
    reservations: activeReservations,
    booked: activeReservations.map(({ seat, slot_id: slotId }) => ({ seat, slotId })),
    closedSlotIds: Array.isArray(setting?.closed_slot_ids) ? setting.closed_slot_ids : [],
    limitMinutes,
    studentMinutes,
    remainingMinutes: limitMinutes ? Math.max(0, limitMinutes - studentMinutes) : null,
  };
}
