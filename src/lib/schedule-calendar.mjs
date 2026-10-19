import { scheduleRows, validateScheduleMonth } from "./schedule-preview.mjs";

export class CalendarScheduleError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

// Public calendar fields only. Never return database IDs or arbitrary payload fields.
const strings = ["date", "time", "grade", "class", "subject", "campus", "room", "groupKey", "label", "displayTitle", "teacher"];
const booleans = ["faceToFace", "special", "isSpecialLesson"];
function publicEvent(payload) {
  if (!payload || typeof payload !== "object") throw new CalendarScheduleError("授業の公開用データを確認できません。");
  return Object.fromEntries([
    ...strings.filter((key) => typeof payload[key] === "string").map((key) => [key, payload[key]]),
    ...booleans.filter((key) => typeof payload[key] === "boolean").map((key) => [key, payload[key]]),
  ]);
}

export function calendarSchedulePayload(rows, month, run) {
  validateScheduleMonth(month);
  if (!run || !["applied", "unchanged"].includes(run.status) || run.month !== month) throw new CalendarScheduleError("この月はまだ取り込みが完了していません。", 404);
  if (!rows.length || rows.length !== run.summary?.incoming) throw new CalendarScheduleError("取り込み済み件数と授業データが一致しません。再確認しています。");
  const schedule = rows.map((row) => publicEvent(row.source_payload));
  let canonical;
  try { canonical = scheduleRows(schedule, month); } catch { throw new CalendarScheduleError("公開する授業の日付・教室・重複を確認できません。"); }
  for (let i = 0; i < rows.length; i++) {
    for (const field of ["source_key", "lesson_date", "start_time", "campus", "classroom", "teacher_name", "label"]) {
      if ((rows[i][field] ?? "") !== (canonical[i][field] ?? "")) throw new CalendarScheduleError("授業と原本の対応を再確認しています。");
    }
  }
  if (["hon", "minami"].some((campus) => !schedule.some((event) => event.campus === campus))) throw new CalendarScheduleError("両校舎の授業が揃っていません。");
  schedule.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.label.localeCompare(b.label));
  const teachers = [...new Set(schedule.map((event) => event.teacher).filter(Boolean))].sort();
  const [year, number] = month.split("-").map(Number);
  return {
    month, count: schedule.length, updatedAt: run.finished_at,
    source: { file: run.source?.file, sha256: run.source?.sha256, modifiedAt: run.source?.modifiedAt },
    schedule,
    teacherSchedule: { year, month: number, teachers, items: schedule.map((event) => ({ ...event,
      campusLabel: event.campus === "hon" ? "本校" : "南教室", teacherLabel: event.teacher || "未判定", title: event.displayTitle || event.label })) },
  };
}

export async function readCalendarSchedule(db, month) {
  try { validateScheduleMonth(month); } catch { throw new CalendarScheduleError("対象月を YYYY-MM で指定してください。", 400); }
  const successful = () => db.from("schedule_sync_runs").select("id,month,status,summary,source,finished_at")
    .eq("month", month).in("status", ["applied", "unchanged"]).order("started_at", { ascending: false }).limit(1);
  const before = await successful();
  if (before.error) throw new CalendarScheduleError("取り込み状況を取得できません。");
  const run = before.data?.[0];
  if (!run) throw new CalendarScheduleError("この月はまだ取り込みが完了していません。", 404);
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 10);
  const load = async () => {
    const rows = [];
    for (let offset = 0; offset < 10000; offset += 500) {
      const result = await db.from("lessons").select("id,updated_at,lesson_date,start_time,campus,classroom,teacher_name,label,source_key,source_payload")
        .gte("lesson_date", `${month}-01`).lt("lesson_date", next).order("id").range(offset, offset + 499);
      if (result.error) throw new CalendarScheduleError("授業データを取得できません。");
      rows.push(...result.data);
      if (result.data.length < 500) return rows;
    }
    throw new CalendarScheduleError("授業件数が上限を超えています。");
  };
  const rows = await load();
  const [after, checked] = await Promise.all([successful(), load()]);
  // A sync applies an entire month atomically. Don't serve a mixed snapshot.
  if (after.error || after.data?.[0]?.id !== run.id || JSON.stringify(rows) !== JSON.stringify(checked)) throw new CalendarScheduleError("授業を更新中です。少し待って再確認してください。", 409);
  return calendarSchedulePayload(rows, month, run);
}
