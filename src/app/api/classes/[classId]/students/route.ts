import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { findLinkedLineUserId, type LineAlias } from "@/lib/student-linking";
import { canonicalTeacherName } from "@/lib/teacher-names";

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

function parseClassId(classId: string) {
  const [grade, subject, ...rest] = decodeURIComponent(classId).split(":");
  return { grade, subject, className: rest.join(":") };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ classId: string }> },
) {
  const { classId } = await context.params;
  const parsed = parseClassId(classId);

  if (!parsed.grade || !parsed.subject || !parsed.className) {
    return NextResponse.json({ error: "invalid class id" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: enrollments, error: enrollmentError } = await supabase
    .from("student_class_enrollments")
    .select("student_number")
    .eq("grade", parsed.grade)
    .eq("subject", parsed.subject)
    .eq("class_name", parsed.className);

  if (enrollmentError) {
    return NextResponse.json({ error: enrollmentError.message }, { status: 500 });
  }

  const studentNumbers = [...new Set((enrollments ?? []).map((row) => row.student_number as string))];
  if (studentNumbers.length === 0) {
    return NextResponse.json({ students: [] });
  }

  const [
    { data: students, error: studentsError },
    { data: aliases, error: aliasesError },
    { data: links, error: linksError },
  ] = await Promise.all([
    supabase
      .from("student_roster")
      .select("student_number,grade,student_name,homeroom_teacher,campus,gender")
      .in("student_number", studentNumbers)
      .order("student_number", { ascending: true }),
    supabase.from("line_user_aliases").select("line_user_id,alias_name"),
    supabase.from("student_line_links").select("student_number,line_user_id"),
  ]);

  if (studentsError) return NextResponse.json({ error: studentsError.message }, { status: 500 });
  if (aliasesError) return NextResponse.json({ error: aliasesError.message }, { status: 500 });
  if (linksError) return NextResponse.json({ error: linksError.message }, { status: 500 });

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

  if (messagesError) return NextResponse.json({ error: messagesError.message }, { status: 500 });

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
      homeroom_teacher: canonicalTeacherName(student.homeroom_teacher),
      line_user_id: lineUserId,
      message_count: stat?.message_count ?? 0,
      latest_at: stat?.latest_at ?? null,
    };
  });

  return NextResponse.json({ students: result });
}
