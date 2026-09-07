import "server-only";
import { NextResponse } from "next/server";

// This response is deliberately independent of credentials, request bodies and
// DB/feature flags: none may reopen the unauthenticated legacy paths.
export function legacyStudyRoomUnavailable() {
  return NextResponse.json({
    code: "legacy_study_room_unavailable",
    error: "この自習室予約・管理機能は現在利用できません。必要な場合は教室へお問い合わせください。",
  }, {
    status: 503,
    headers: { "Cache-Control": "no-store", "Pragma": "no-cache" },
  });
}
