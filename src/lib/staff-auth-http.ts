import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import {
  isStaffSameOrigin, requireStaff, STAFF_ACCESS_COOKIE, STAFF_REFRESH_COOKIE,
  StaffAuthError, staffCookieOptions,
} from "@/lib/staff-auth-core.mjs";

export function assertStaffAuthEnabled() {
  if (process.env.STAFF_AUTH_ENABLED !== "true" || !process.env.STAFF_AUTH_ORIGIN) {
    throw new StaffAuthError("auth_unavailable", 503);
  }
}

export function assertStaffMutationOrigin(request: NextRequest) {
  assertStaffAuthEnabled();
  if (!isStaffSameOrigin(request, process.env.STAFF_AUTH_ORIGIN)) {
    throw new StaffAuthError("origin_denied", 403);
  }
}

export async function staffJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new StaffAuthError("invalid_request", 400);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new StaffAuthError("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new StaffAuthError("invalid_request", 413);
      }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof StaffAuthError) throw error;
    throw new StaffAuthError("invalid_request", 400);
  } finally { reader.releaseLock(); }
}

export async function staffContext(request: NextRequest) {
  assertStaffAuthEnabled();
  const dataClient = createSupabaseAdminClient();
  // Do not reuse the password-sign-in client for privileged database operations.
  const identityClient = createSupabaseAdminClient();
  const authenticated = await requireStaff({
    identityClient, dataClient,
    accessToken: request.cookies.get(STAFF_ACCESS_COOKIE)?.value,
    refreshToken: request.cookies.get(STAFF_REFRESH_COOKIE)?.value,
  });
  return { ...authenticated, dataClient };
}

type CookieSession = { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number };
type CookieContext = { session?: CookieSession | null; staff: { expiresAt: string } };

export function staffResponse(body: unknown, context?: CookieContext, status = 200) {
  const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } });
  if (context?.session) {
    const remaining = Math.max(0, Math.floor((Date.parse(context.staff.expiresAt) - Date.now()) / 1000));
    const accessRemaining = context.session.expires_at
      ? Math.floor(context.session.expires_at - Date.now() / 1000) : (context.session.expires_in ?? 3600);
    response.cookies.set(STAFF_ACCESS_COOKIE, context.session.access_token,
      { ...staffCookieOptions(Math.max(0, Math.min(remaining, accessRemaining))), sameSite: "strict" });
    response.cookies.set(STAFF_REFRESH_COOKIE, context.session.refresh_token,
      { ...staffCookieOptions(remaining), sameSite: "strict" });
  }
  return response;
}

export function clearStaffCookies(response: NextResponse) {
  for (const name of [STAFF_ACCESS_COOKIE, STAFF_REFRESH_COOKIE]) {
    response.cookies.set(name, "", { ...staffCookieOptions(0), sameSite: "strict" });
  }
  return response;
}

export function staffErrorResponse(error: unknown, context?: CookieContext) {
  const known = error instanceof StaffAuthError ? error : new StaffAuthError("auth_unavailable", 503);
  const messages: Record<string, string> = {
    auth_unavailable: "職員認証を利用できません。準備状況または接続を確認してください。",
    invalid_credentials: "職員コードまたはパスワードを確認してください。",
    invalid_session: "ログインし直してください。",
    try_later: "しばらく待ってからログインし直してください。",
    permission_denied: "この操作を行う権限がありません。",
    origin_denied: "勉たんの画面から操作してください。",
    reservation_conflict: "予約状況が変わっています。一覧を更新して確認してください。",
    reason_required: "理由を入力してください。",
    invalid_request: "入力内容を確認してください。",
  };
  // Persist a rotated refresh cookie even when the business operation returns 409.
  const response = staffResponse({ error: messages[String(known.code)] ?? messages.auth_unavailable,
    code: known.code }, context, known.status);
  if (known.status === 401) clearStaffCookies(response);
  return response;
}
