import { NextRequest } from "next/server";
import { StaffAuthError } from "@/lib/staff-auth-core.mjs";
import { assertStaffMutationOrigin, staffJsonBody, staffContext, staffErrorResponse, staffResponse } from "@/lib/staff-auth-http";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new StaffAuthError("invalid_request", 400);
    const { data, error } = await context.dataClient.rpc("get_bentan_feedback_inbox", {
      p_auth_user_id: context.identity.authUserId, p_auth_session_id: context.identity.authSessionId, p_offset: offset,
      p_unreviewed_only: request.nextUrl.searchParams.get("unreviewed") === "true",
    });
    if (error) throw new StaffAuthError(error.message === "staff_permission_denied" ? "permission_denied" : "auth_unavailable", error.message === "staff_permission_denied" ? 403 : 503);
    return staffResponse(data, context);
  } catch (error) { return staffErrorResponse(error, context); }
}

export async function POST(request: NextRequest) {
  let context;
  try {
    assertStaffMutationOrigin(request);
    context = await staffContext(request);
    const body = await staffJsonBody(request);
    if (typeof body.id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.id)) throw new StaffAuthError("invalid_request", 400);
    const result = await context.dataClient.rpc("review_bentan_feedback", {
      p_auth_user_id: context.identity.authUserId, p_auth_session_id: context.identity.authSessionId, p_id: body.id,
    });
    if (result.error) throw new StaffAuthError(result.error.message === "staff_permission_denied" ? "permission_denied" : result.error.message === "invalid_feedback" ? "invalid_request" : "auth_unavailable", result.error.message === "staff_permission_denied" ? 403 : result.error.message === "invalid_feedback" ? 400 : 503);
    return staffResponse(result.data, context);
  } catch (error) { return staffErrorResponse(error, context); }
}
