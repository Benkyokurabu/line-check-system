import { NextRequest } from "next/server";
import { STAFF_ACCESS_COOKIE, STAFF_REFRESH_COOKIE } from "@/lib/staff-auth-core.mjs";
import { staffContext, staffResponse, staffErrorResponse } from "@/lib/staff-auth-http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // The unprotected daily work pages keep their existing anonymous behavior.
  if (!request.cookies.get(STAFF_ACCESS_COOKIE)?.value && !request.cookies.get(STAFF_REFRESH_COOKIE)?.value) {
    return staffResponse({ authenticated: false });
  }
  try {
    const context = await staffContext(request);
    return staffResponse({ authenticated: true }, context);
  } catch (error) { return staffErrorResponse(error); }
}
