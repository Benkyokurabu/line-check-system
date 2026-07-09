import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { findLinkedLineUserId, type LineAlias } from "@/lib/student-linking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RosterRow = {
  student_number: string;
  grade: string;
  student_name: string;
  homeroom_teacher: string;
  campus: string | null;
  gender: string | null;
};

type StudentLineLink = {
  student_number: string;
  line_user_id: string;
};

export async function GET(request: Request) {
  const teacher = new URL(request.url).searchParams.get("teacher")?.trim();
  const supabase = createSupabaseAdminClient();

  let rosterQuery = supabase
    .from("student_roster")
    .select("student_number,grade,student_name,homeroom_teacher,campus,gender")
    .order("grade", { ascending: true })
    .order("student_number", { ascending: true });

  if (teacher) {
    rosterQuery = rosterQuery.eq("homeroom_teacher", teacher);
  }

  const [
    { data: students, error: studentsError },
    { data: aliases, error: aliasesError },
    { data: links, error: linksError },
  ] = await Promise.all([
    rosterQuery,
    supabase.from("line_user_aliases").select("line_user_id,alias_name"),
    supabase.from("student_line_links").select("student_number,line_user_id"),
  ]);

  if (studentsError) {
    return NextResponse.json({ error: studentsError.message }, { status: 500 });
  }
  if (aliasesError) {
    return NextResponse.json({ error: aliasesError.message }, { status: 500 });
  }
  if (linksError) {
    return NextResponse.json({ error: linksError.message }, { status: 500 });
  }

  const aliasRows = (aliases ?? []) as LineAlias[];
  const linkMap = new Map(
    ((links ?? []) as StudentLineLink[]).map((link) => [link.student_number, link.line_user_id]),
  );
  const linkedUserIds = [
    ...new Set(
      ((students ?? []) as RosterRow[])
        .map((student) => linkMap.get(student.student_number) ?? findLinkedLineUserId(student.student_name, aliasRows))
        .filter((id): id is string => !!id),
    ),
  ];

  const { data: messages, error: messagesError } =
    linkedUserIds.length > 0
      ? await supabase
          .from("line_messages")
          .select("line_user_id,received_at,created_at")
          .in("line_user_id", linkedUserIds)
      : { data: [], error: null };

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  const stats = new Map<string, { message_count: number; latest_at: string | null }>();
  for (const message of messages ?? []) {
    const userId = message.line_user_id as string;
    const at = ((message.received_at as string | null) ?? (message.created_at as string | null)) ?? null;
    const current = stats.get(userId) ?? { message_count: 0, latest_at: null };
    current.message_count += 1;
    if (at && (!current.latest_at || new Date(at).getTime() > new Date(current.latest_at).getTime())) {
      current.latest_at = at;
    }
    stats.set(userId, current);
  }

  const result = ((students ?? []) as RosterRow[]).map((student) => {
    const lineUserId = linkMap.get(student.student_number) ?? findLinkedLineUserId(student.student_name, aliasRows);
    const stat = lineUserId ? stats.get(lineUserId) : null;
    return {
      ...student,
      line_user_id: lineUserId,
      message_count: stat?.message_count ?? 0,
      latest_at: stat?.latest_at ?? null,
    };
  });

  return NextResponse.json({ students: result });
}
