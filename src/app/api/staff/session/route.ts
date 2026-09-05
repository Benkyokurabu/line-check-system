import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { loginStaff, logoutStaff, STAFF_ACCESS_COOKIE, STAFF_REFRESH_COOKIE } from "@/lib/staff-auth-core.mjs";
import {
  assertStaffMutationOrigin, clearStaffCookies, staffContext, staffErrorResponse, staffJsonBody, staffResponse,
} from "@/lib/staff-auth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await staffContext(request);
    return staffResponse({ staff: context.staff }, context);
  } catch (error) { return staffErrorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertStaffMutationOrigin(request);
    const body = await staffJsonBody(request);
    const context = await loginStaff({ identityClient: createSupabaseAdminClient(),
      dataClient: createSupabaseAdminClient(), staffCode: body.staffCode, password: body.password });
    return staffResponse({ staff: context.staff }, context);
  } catch (error) { return staffErrorResponse(error); }
}

export async function DELETE(request: NextRequest) {
  try { assertStaffMutationOrigin(request); }
  catch (error) { return staffErrorResponse(error); }
  try {
    await logoutStaff({ identityClient: createSupabaseAdminClient(), adminClient: createSupabaseAdminClient(),
      accessToken: request.cookies.get(STAFF_ACCESS_COOKIE)?.value,
      refreshToken: request.cookies.get(STAFF_REFRESH_COOKIE)?.value });
    return clearStaffCookies(staffResponse({ loggedOut: true }));
  } catch (error) { return clearStaffCookies(staffErrorResponse(error)); }
}
