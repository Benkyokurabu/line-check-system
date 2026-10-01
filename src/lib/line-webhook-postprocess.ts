import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { autoLinkLineSenders } from "@/lib/line-auto-link";

export type SavedInboundMessage = {
  id: string;
  line_message_id: string;
  line_user_id: string;
  display_name: string | null;
  text: string | null;
  message_type: string;
  media_file_name: string | null;
  media_status?: string | null;
};

const MEDIA_BUCKET = "line-message-media";
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const DOWNLOADABLE_MESSAGE_TYPES = new Set(["image", "video", "audio", "file"]);

async function fetchDisplayName(userId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { displayName?: string };
    return typeof data.displayName === "string" ? data.displayName : null;
  } catch {
    return null;
  }
}

function safeFileName(value: string) {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120) || "file";
}

function extensionFor(contentType: string | null, messageType: string) {
  const mime = contentType?.split(";")[0].trim().toLowerCase();
  const byMime: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
    "application/pdf": ".pdf", "video/mp4": ".mp4", "audio/m4a": ".m4a", "audio/mp4": ".m4a",
  };
  return byMime[mime ?? ""] ?? (messageType === "image" ? ".jpg" : "");
}

async function saveMedia(supabase: SupabaseClient, row: SavedInboundMessage, accessToken: string) {
  try {
    const response = await fetch(`https://api-data.line.me/v2/bot/message/${row.line_message_id}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`LINE content API returned ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_MEDIA_BYTES) {
      const { error } = await supabase.from("line_messages").update({
        media_status: "too_large", media_size_bytes: declaredSize, media_error: "File exceeds 50 MB limit",
      }).eq("id", row.id);
      if (error) throw error;
      return;
    }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > MAX_MEDIA_BYTES) {
      const { error } = await supabase.from("line_messages").update({
        media_status: "too_large", media_size_bytes: body.byteLength, media_error: "File exceeds 50 MB limit",
      }).eq("id", row.id);
      if (error) throw error;
      return;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    const originalName = row.media_file_name?.trim();
    const fileName = safeFileName(originalName || `${row.message_type}${extensionFor(contentType, row.message_type)}`);
    const storagePath = `${row.line_user_id}/${row.line_message_id}/${fileName}`;
    const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(storagePath, body, {
      contentType, upsert: false,
    });
    if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) throw uploadError;
    const { error: updateError } = await supabase.from("line_messages").update({
      media_storage_path: storagePath,
      media_content_type: contentType,
      media_file_name: originalName || fileName,
      media_size_bytes: body.byteLength,
      media_status: "saved",
      media_error: null,
    }).eq("id", row.id);
    if (updateError) throw updateError;
  } catch (error) {
    console.error("Failed to save LINE media", row.line_message_id, error);
    const { error: statusError } = await supabase.from("line_messages").update({
      media_status: "failed",
      media_error: error instanceof Error ? error.message.slice(0, 500) : "Unknown media save error",
    }).eq("id", row.id);
    if (statusError) console.error("Failed to record LINE media error", row.line_message_id, statusError);
  }
}

export async function processSavedLineMessages(supabase: SupabaseClient, rows: SavedInboundMessage[], accessToken: string) {
  if (!accessToken || rows.length === 0) return { processed: 0, named: 0, media: 0 };
  const userIds = [...new Set(rows.map((row) => row.line_user_id))];
  const profiles = await Promise.all(userIds.map(async (userId) => [userId, await fetchDisplayName(userId, accessToken)] as const));
  const names = new Map(profiles);
  const namedRows = rows.map((row) => ({ ...row, display_name: names.get(row.line_user_id) ?? row.display_name }));
  const nameUpdates = await Promise.allSettled(namedRows.filter((row) => row.display_name && !rows.find((item) => item.id === row.id)?.display_name).map(async (row) => {
    const { error } = await supabase.from("line_messages").update({ display_name: row.display_name }).eq("id", row.id);
    if (error) throw error;
  }));
  for (const update of nameUpdates) if (update.status === "rejected") console.error("LINE profile update failed", update.reason);
  try {
    await autoLinkLineSenders(supabase, namedRows.map((row) => ({
      id: row.id, line_user_id: row.line_user_id, display_name: row.display_name, text: row.text,
    })));
  } catch (cause) {
    console.error("LINE sender linking failed", cause);
  }
  const mediaRows = namedRows.filter((row) => DOWNLOADABLE_MESSAGE_TYPES.has(row.message_type) &&
    (!row.media_status || row.media_status === "pending" || row.media_status === "failed"));
  await Promise.all(mediaRows.map((row) => saveMedia(supabase, row, accessToken)));
  return { processed: rows.length, named: namedRows.filter((row) => row.display_name).length, media: mediaRows.length };
}
