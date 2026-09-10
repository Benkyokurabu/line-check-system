import { NextRequest } from "next/server";
import { StaffAuthError } from "@/lib/staff-auth-core.mjs";
import { staffContext, staffErrorResponse, staffResponse } from "@/lib/staff-auth-http";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new StaffAuthError("invalid_request", 400);
    const { data, error } = await context.dataClient.rpc("list_bentan_feedback", {
      p_auth_user_id: context.identity.authUserId, p_auth_session_id: context.identity.authSessionId, p_offset: offset,
    });
    if (error) throw new StaffAuthError(error.message === "staff_permission_denied" ? "permission_denied" : "auth_unavailable", error.message === "staff_permission_denied" ? 403 : 503);
    return staffResponse(data, context);
  } catch (error) { return staffErrorResponse(error, context); }
}
