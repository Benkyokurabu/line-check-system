import "server-only";

import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

// LINE Webhook は Node.js ランタイムで実行する（HMAC 署名検証に crypto を使うため）。
export const runtime = "nodejs";
// 署名検証のため raw body を毎回読む必要があるのでキャッシュさせない。
export const dynamic = "force-dynamic";

// line_messages.message_type の CHECK 制約に存在する値だけを許可し、
// それ以外（location / imagemap など）は "unknown" に丸める。
const ALLOWED_MESSAGE_TYPES = new Set([
  "text",
  "image",
  "video",
  "audio",
  "file",
  "sticker",
]);

type LineMessageRow = {
  line_message_id: string;
  line_user_id: string;
  display_name: string | null;
  message_type: string;
  text: string | null;
  direction: "inbound";
  received_at: string | null;
  raw_event: unknown;
  media_file_name: string | null;
  media_status: "not_applicable" | "pending";
};

const DOWNLOADABLE_MESSAGE_TYPES = new Set(["image", "video", "audio", "file"]);
const MEDIA_BUCKET = "line-message-media";
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

async function fetchDisplayName(
  userId: string,
  accessToken: string,
): Promise<string | null> {
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

/**
 * x-line-signature ヘッダーを HMAC-SHA256(channelSecret, rawBody) の Base64 と比較する。
 * 必ず JSON.parse 前の raw body 文字列を使う。
 */
function isValidSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);

  // 長さが違うと timingSafeEqual が例外を投げるので先に弾く。
  if (expectedBuf.length !== signatureBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

function buildRow(event: unknown): LineMessageRow | null {
  if (typeof event !== "object" || event === null) return null;

  const e = event as Record<string, unknown>;
  if (e.type !== "message") return null;

  const message = e.message as Record<string, unknown> | undefined;
  if (!message || typeof message.id !== "string") return null;

  const source = e.source as Record<string, unknown> | undefined;
  const lineUserId =
    typeof source?.userId === "string" ? source.userId : null;
  // line_user_id は NOT NULL 制約。userId が取れない（グループ等）イベントは保存対象外。
  if (!lineUserId) return null;

  const rawType = typeof message.type === "string" ? message.type : "unknown";
  const messageType = ALLOWED_MESSAGE_TYPES.has(rawType) ? rawType : "unknown";

  const text =
    messageType === "text" && typeof message.text === "string"
      ? message.text
      : null;
  const mediaFileName = messageType === "file" && typeof message.fileName === "string"
    ? message.fileName
    : null;

  const timestamp =
    typeof e.timestamp === "number" ? new Date(e.timestamp).toISOString() : null;

  return {
    line_message_id: message.id,
    line_user_id: lineUserId,
    display_name: null,
    message_type: messageType,
    text,
    direction: "inbound",
    received_at: timestamp,
    raw_event: event,
    media_file_name: mediaFileName,
    media_status: DOWNLOADABLE_MESSAGE_TYPES.has(messageType) ? "pending" : "not_applicable",
  };
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

async function saveMedia(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  row: { id: string; line_message_id: string; line_user_id: string; message_type: string; media_file_name: string | null },
  accessToken: string,
) {
  try {
    const response = await fetch(`https://api-data.line.me/v2/bot/message/${row.line_message_id}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`LINE content API returned ${response.status}`);

    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_MEDIA_BYTES) {
      await supabase.from("line_messages").update({
        media_status: "too_large", media_size_bytes: declaredSize, media_error: "File exceeds 50 MB limit",
      }).eq("id", row.id);
      return;
    }

    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > MAX_MEDIA_BYTES) {
      await supabase.from("line_messages").update({
        media_status: "too_large", media_size_bytes: body.byteLength, media_error: "File exceeds 50 MB limit",
      }).eq("id", row.id);
      return;
    }

    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    const originalName = row.media_file_name?.trim();
    const fileName = safeFileName(originalName || `${row.message_type}${extensionFor(contentType, row.message_type)}`);
    const storagePath = `${row.line_user_id}/${row.line_message_id}/${fileName}`;
    const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(storagePath, body, {
      contentType,
      upsert: false,
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
    await supabase.from("line_messages").update({
      media_status: "failed",
      media_error: error instanceof Error ? error.message.slice(0, 500) : "Unknown media save error",
    }).eq("id", row.id);
  }
}

export async function POST(request: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    console.error("LINE_CHANNEL_SECRET is not configured");
    return NextResponse.json(
      { error: "server misconfigured" },
      { status: 500 },
    );
  }

  // 署名検証には raw body を使う（JSON 化後の body では検証できない）。
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!isValidSignature(rawBody, signature, channelSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: { events?: unknown[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // 署名は通っているが JSON が壊れている場合。LINE の検証は空 events なので通常起きない。
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  const rows = events
    .map(buildRow)
    .filter((row): row is LineMessageRow => row !== null);

  if (rows.length > 0) {
    try {
      const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
      const uniqueUserIds = [...new Set(rows.map((r) => r.line_user_id))];
      const profiles = await Promise.all(
        uniqueUserIds.map(async (userId) => {
          const name = await fetchDisplayName(userId, accessToken);
          return [userId, name] as [string, string | null];
        }),
      );
      const profileMap = Object.fromEntries(profiles);
      const rowsWithNames = rows.map((r) => ({
        ...r,
        display_name: profileMap[r.line_user_id] ?? null,
      }));

      const supabase = createSupabaseAdminClient();
      // line_message_id の unique 制約で重複を防ぐ。同一 ID は無視（再送対策）。
      const { data: savedRows, error } = await supabase
        .from("line_messages")
        .upsert(rowsWithNames, {
          onConflict: "line_message_id",
          ignoreDuplicates: true,
        })
        .select("id,line_message_id,line_user_id,message_type,media_file_name");

      if (error) {
        console.error("Failed to upsert line_messages", error);
      } else if (accessToken) {
        await Promise.all(
          (savedRows ?? [])
            .filter((row) => DOWNLOADABLE_MESSAGE_TYPES.has(row.message_type))
            .map((row) => saveMedia(supabase, row, accessToken)),
        );
      }
    } catch (err) {
      // 保存に失敗しても LINE には 200 を返す（リトライ嵐を避ける）。失敗はログで追う。
      console.error("Unexpected error while saving line_messages", err);
    }
  }

  // LINE には常に短時間で 200 を返す。
  return NextResponse.json({ ok: true }, { status: 200 });
}
