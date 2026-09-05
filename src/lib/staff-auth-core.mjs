// Server-side orchestration. No provider token or internal login address is returned
// in the public staff profile. Inject separate identity/data clients per request.
import { isValidReservationDate } from "./reservation-date.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STAFF_ACCESS_COOKIE = "__Host-bentan-staff-access";
export const STAFF_REFRESH_COOKIE = "__Host-bentan-staff-refresh";

export class StaffAuthError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function isStaffSameOrigin(request, configuredOrigin) {
  if (typeof configuredOrigin !== "string" || !configuredOrigin) return false;
  try {
    const expected = new URL(configuredOrigin);
    return expected.protocol === "https:" && expected.origin === configuredOrigin
      && request.headers.get("origin") === expected.origin
      && !["cross-site", "none"].includes(request.headers.get("sec-fetch-site"));
  } catch { return false; }
}

export function staffCookieOptions(maxAge) {
  return { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge };
}

// This is extraction AFTER getUser verified the token, never JWT verification.
function verifiedSessionId(token, verifiedUserId) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (payload.sub !== verifiedUserId || !UUID.test(payload.session_id)) throw new Error();
    return payload.session_id;
  } catch { throw new StaffAuthError("invalid_session"); }
}

function dbAuthError(error) {
  if (error?.message === "staff_permission_denied") return new StaffAuthError("permission_denied", 403);
  if (["staff_access_denied", "staff_session_invalid", "staff_session_expired"].includes(error?.message)) {
    return new StaffAuthError("invalid_session");
  }
  return new StaffAuthError("auth_unavailable", 503);
}

async function verifiedIdentity(identityClient, accessToken) {
  if (typeof accessToken !== "string" || !accessToken || accessToken.length > 16384) {
    throw new StaffAuthError("invalid_session");
  }
  const { data, error } = await identityClient.auth.getUser(accessToken);
  if (error || !data?.user?.id) {
    if (error?.status >= 500 || error?.name === "AuthRetryableFetchError") throw new StaffAuthError("auth_unavailable", 503);
    throw new StaffAuthError("invalid_session");
  }
  return { authUserId: data.user.id, authSessionId: verifiedSessionId(accessToken, data.user.id) };
}

async function authorize(dataClient, identity, initialize = false) {
  const { data, error } = await dataClient.rpc("staff_authorize", {
    p_auth_user_id: identity.authUserId, p_auth_session_id: identity.authSessionId,
    p_permission: null, p_initialize: initialize,
  });
  if (error) throw dbAuthError(error);
  if (!data?.staffId || !data?.expiresAt) throw new StaffAuthError("auth_unavailable", 503);
  return data;
}

export async function loginStaff({ identityClient, dataClient, staffCode, password }) {
  if (typeof staffCode !== "string" || !staffCode.trim() || staffCode.trim().length > 64
    || typeof password !== "string" || !password || password.length > 1024) {
    throw new StaffAuthError("invalid_credentials");
  }
  const { data: target, error } = await dataClient.rpc("staff_login_target", { p_staff_code: staffCode.trim() });
  if (error) throw dbAuthError(error);
  if (target?.limited) throw new StaffAuthError("try_later", 429);
  // An unknown code still reaches the same managed password-verification path.
  const { data, error: signInError } = await identityClient.auth.signInWithPassword({
    email: target?.email ?? "unregistered-staff@invalid.invalid", password,
  });
  if (signInError?.status >= 500 || signInError?.name === "AuthRetryableFetchError") {
    throw new StaffAuthError("auth_unavailable", 503);
  }
  if (signInError || !data?.session || !target?.authUserId || data.user?.id !== target.authUserId) {
    throw new StaffAuthError("invalid_credentials");
  }
  const identity = await verifiedIdentity(identityClient, data.session.access_token);
  const staff = await authorize(dataClient, identity, true);
  return { staff, identity, session: data.session };
}

export async function requireStaff({ identityClient, dataClient, accessToken, refreshToken }) {
  let identity;
  let session = null;
  try {
    identity = await verifiedIdentity(identityClient, accessToken);
  } catch (error) {
    if (!(error instanceof StaffAuthError) || error.status !== 401
      || typeof refreshToken !== "string" || !refreshToken || refreshToken.length > 16384) throw error;
    const result = await identityClient.auth.refreshSession({ refresh_token: refreshToken });
    if (result.error || !result.data?.session) {
      if (result.error?.status >= 500 || result.error?.name === "AuthRetryableFetchError") throw new StaffAuthError("auth_unavailable", 503);
      throw new StaffAuthError("invalid_session");
    }
    session = result.data.session;
    identity = await verifiedIdentity(identityClient, session.access_token);
  }
  const staff = await authorize(dataClient, identity);
  return { staff, identity, session };
}

// Logout does not require an active staff role: disabled staff must still be able
// to revoke their managed session. Never treat provider failure as revocation.
export async function logoutStaff({ identityClient, adminClient, accessToken, refreshToken }) {
  let token = accessToken;
  try {
    await verifiedIdentity(identityClient, token);
  } catch (error) {
    if (!(error instanceof StaffAuthError) || error.status !== 401) throw error;
    if (typeof refreshToken !== "string" || !refreshToken || refreshToken.length > 16384) return;
    const result = await identityClient.auth.refreshSession({ refresh_token: refreshToken });
    if (result.error) {
      // Only explicit invalid/expired refresh credentials mean already logged out.
      if (["refresh_token_not_found", "refresh_token_already_used", "session_not_found"].includes(result.error.code)) return;
      throw new StaffAuthError("auth_unavailable", 503);
    }
    token = result.data?.session?.access_token;
    await verifiedIdentity(identityClient, token);
  }
  const { error } = await adminClient.auth.admin.signOut(token, "local");
  if (error) throw new StaffAuthError("auth_unavailable", 503);
}

export async function transitionStaffStudyRoom(dataClient, identity, input) {
  if (!UUID.test(input?.operationKey ?? "") || !UUID.test(input?.requestId ?? "")
    || !Number.isSafeInteger(input?.expectedVersion) || input.expectedVersion < 1
    || !["approve", "reject", "cancel"].includes(input?.action)
    || (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 2000))) {
    throw new StaffAuthError("invalid_request", 400);
  }
  const { data, error } = await dataClient.rpc("staff_study_room_transition", {
    p_auth_user_id: identity.authUserId, p_auth_session_id: identity.authSessionId,
    p_operation_key: input.operationKey, p_request_id: input.requestId,
    p_expected_version: input.expectedVersion, p_action: input.action, p_reason: input.reason ?? "",
  });
  if (error) {
    if (["seat_unavailable", "student_slot_conflict", "daily_limit_exceeded", "slot_closed",
      "past_date", "version_conflict", "invalid_state_transition", "idempotency_conflict"].includes(error.message)) {
      throw new StaffAuthError("reservation_conflict", 409);
    }
    if (error.message === "reason_required") throw new StaffAuthError("reason_required", 400);
    throw dbAuthError(error);
  }
  return data;
}

/** @param {object} dataClient @param {object} identity @param {{date: unknown, status?: string | null, offset?: number}} input */
export async function listStaffStudyRoom(dataClient, identity, { date, status = null, offset = 0 }) {
  if (!isValidReservationDate(date) || (status !== null && !["pending", "approved", "rejected", "cancelled"].includes(status))
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483597) {
    throw new StaffAuthError("invalid_request", 400);
  }
  const { data, error } = await dataClient.rpc("staff_study_room_requests", {
    p_auth_user_id: identity.authUserId, p_auth_session_id: identity.authSessionId,
    p_date: date, p_status: status, p_offset: offset,
  });
  if (error) throw dbAuthError(error);
  return data;
}
