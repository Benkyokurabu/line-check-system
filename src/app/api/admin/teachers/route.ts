import { NextResponse } from "next/server";

import { canonicalTeacherName } from "@/lib/teacher-names";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("teachers")
    .select("id, display_name")
    .order("display_name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const teachers = [
    ...new Map(
      (data ?? []).map((teacher) => {
        const displayName = canonicalTeacherName(teacher.display_name as string);
        return [displayName, { ...teacher, display_name: displayName }];
      }),
    ).values(),
  ].sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));

  return NextResponse.json({ teachers });
}