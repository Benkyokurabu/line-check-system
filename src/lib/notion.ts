import "server-only";

const NOTION_VERSION = process.env.NOTION_VERSION ?? "2025-09-03";

function token() {
  const value = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
  if (!value) throw new Error("NOTION_TOKEN is not configured");
  return value;
}

export async function notionRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : `Notion API ${response.status}`;
    throw new Error(message);
  }
  return body;
}

export function notionAttendanceDataSourceId() {
  const value = process.env.NOTION_ATTENDANCE_DATA_SOURCE_ID;
  if (!value) throw new Error("NOTION_ATTENDANCE_DATA_SOURCE_ID is not configured");
  return value;
}

const ABSENCE_DB_DATA_SOURCE_ID = "19ef0120-80a7-805c-ae16-000b7b414034";
const DEPRECATED_ATTENDANCE_DATA_SOURCE_IDS = new Set([
  "f9a142ea-72f4-4660-b4f9-36e8dacf1e08",
]);

export function notionAbsenceDataSourceId() {
  const configured = process.env.NOTION_ABSENCE_DATA_SOURCE_ID ?? process.env.NOTION_ATTENDANCE_DATA_SOURCE_ID;
  if (!configured || DEPRECATED_ATTENDANCE_DATA_SOURCE_IDS.has(configured)) return ABSENCE_DB_DATA_SOURCE_ID;
  return configured;
}
