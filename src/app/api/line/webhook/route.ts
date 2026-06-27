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
};

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
  };
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
      const { error } = await supabase
        .from("line_messages")
        .upsert(rowsWithNames, {
          onConflict: "line_message_id",
          ignoreDuplicates: true,
        });

      if (error) {
        console.error("Failed to upsert line_messages", error);
      }
    } catch (err) {
      // 保存に失敗しても LINE には 200 を返す（リトライ嵐を避ける）。失敗はログで追う。
      console.error("Unexpected error while saving line_messages", err);
    }
  }

  // LINE には常に短時間で 200 を返す。
  return NextResponse.json({ ok: true }, { status: 200 });
}
