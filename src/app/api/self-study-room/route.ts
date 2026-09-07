import { legacyStudyRoomUnavailable } from "@/lib/legacy-study-room-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retired unauthenticated endpoints must stay closed even after staff auth or
// the approval workflow is enabled. Do not restore direct inventory access here.
export function GET() {
  return legacyStudyRoomUnavailable();
}

export function POST() {
  return legacyStudyRoomUnavailable();
}
