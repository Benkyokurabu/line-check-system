import { NextRequest } from "next/server";
import { staffContext, staffErrorResponse, staffResponse } from "@/lib/staff-auth-http";
import { StaffAuthError } from "@/lib/staff-auth-core.mjs";
import { isValidReservationDate } from "@/lib/reservation-date.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  let context: Awaited<ReturnType<typeof staffContext>> | undefined;
  try {
    context = await staffContext(request);
    const params = request.nextUrl.searchParams;
    const date = params.get("date"); const query = params.get("query") ?? ""; const student = params.get("student");
    if (!isValidReservationDate(date) || query.length>64 || (student !== null && (!student.trim() || student.length>64))) throw new StaffAuthError("invalid_request",400);
    const { data,error } = await context.dataClient.rpc("staff_study_room_intake_options",{
      p_auth_user_id:context.identity.authUserId,p_auth_session_id:context.identity.authSessionId,
      p_date:date,p_query:query,p_student_number:student,
    });
    if (error) {
      if (error.message === "staff_permission_denied") throw new StaffAuthError("permission_denied",403);
      if (["staff_access_denied","staff_session_invalid","staff_session_expired"].includes(error.message)) throw new StaffAuthError("invalid_session");
      if (error.message === "student_not_found") throw new StaffAuthError("invalid_request",400);
      throw new StaffAuthError("auth_unavailable",503);
    }
    return staffResponse(data,context);
  } catch(error) { return staffErrorResponse(error,context); }
}
