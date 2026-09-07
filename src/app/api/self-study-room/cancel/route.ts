import { legacyStudyRoomUnavailable } from "@/lib/legacy-study-room-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST() {
  return legacyStudyRoomUnavailable();
}
