import { legacyStudyRoomUnavailable } from "@/lib/legacy-study-room-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff operations are available only through the authenticated /api/staff routes.
export function GET() {
  return legacyStudyRoomUnavailable();
}

export function POST() {
  return legacyStudyRoomUnavailable();
}
