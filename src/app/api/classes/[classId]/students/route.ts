import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { findLinkedLineAccounts, findLinkedLineUserId, type LineAccount, type LineAlias } from "@/lib/student-linking";
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

type StudentLineAccount = {
  student_number: string;
  line_user_id: string;
  relation: string;
  alias_name: string | null;
  friend_display_name: string | null;
  is_primary: boolean;
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
    { data: accounts, error: accountsError },
  ] = await Promise.all([
    supabase
      .from("student_roster")
      .select("student_number,grade,student_name,homeroom_teacher,campus,gender")
      .in("student_number", studentNumbers)
      .order("student_number", { ascending: true }),
    supabase.from("line_user_aliases").select("line_user_id,alias_name"),
    supabase.from("student_line_links").select("student_number,line_user_id"),
    supabase
      .from("student_line_accounts")
      .select("student_number,line_user_id,relation,alias_name,friend_display_name,is_primary"),
  ]);

  if (studentsError) return NextResponse.json({ error: studentsError.message }, { status: 500 });
  if (aliasesError) return NextResponse.json({ error: aliasesError.message }, { status: 500 });
  if (linksError) return NextResponse.json({ error: linksError.message }, { status: 500 });
  if (accountsError && accountsError.code !== "42P01") return NextResponse.json({ error: accountsError.message }, { status: 500 });

  const aliasRows = (aliases ?? []) as LineAlias[];
  const linkMap = new Map(
    ((links ?? []) as StudentLineLink[]).map((link) => [link.student_number, link.line_user_id]),
  );
  const accountsByStudent = new Map<string, StudentLineAccount[]>();
  for (const account of (accounts ?? []) as StudentLineAccount[]) {
    if (!accountsByStudent.has(account.student_number)) accountsByStudent.set(account.student_number, []);
    accountsByStudent.get(account.student_number)!.push(account);
  }
  const linkedUserIds = [
    ...new Set(
      ((students ?? []) as RosterRow[]).flatMap((student) => {
        const explicitAccounts = accountsByStudent.get(student.student_number) ?? [];
        const inferredAccounts = findLinkedLineAccounts(student.student_name, aliasRows);
        const accountIds = [...explicitAccounts, ...inferredAccounts].map((account) => account.line_user_id);
        const fallback = linkMap.get(student.student_number) ?? findLinkedLineUserId(student.student_name, aliasRows);
        return [...accountIds, fallback].filter((id): id is string => !!id);
      }),
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
    const lineAccounts = mergeAccounts(
      accountsByStudent.get(student.student_number) ?? [],
      findLinkedLineAccounts(student.student_name, aliasRows),
    );
    const primaryAccount =
      lineAccounts.find((account) => account.is_primary) ??
      lineAccounts.find((account) => account.relation === "mother") ??
      lineAccounts[0] ??
      null;
    const lineUserId =
      primaryAccount?.line_user_id ??
      linkMap.get(student.student_number) ??
      findLinkedLineUserId(student.student_name, aliasRows);
    const accountStats = [
      ...lineAccounts.map((account) => account.line_user_id),
      ...(lineUserId ? [lineUserId] : []),
    ]
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .map((id) => stats.get(id))
      .filter((stat): stat is { message_count: number; latest_at: string | null } => Boolean(stat));
    const messageCount = accountStats.reduce((total, stat) => total + stat.message_count, 0);
    const latestAt = accountStats
      .map((stat) => stat.latest_at)
      .filter((at): at is string => Boolean(at))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
    return {
      ...student,
      homeroom_teacher: canonicalTeacherName(student.homeroom_teacher),
      line_user_id: lineUserId,
      line_accounts: lineAccounts,
      line_account_count: lineAccounts.length,
      message_count: messageCount,
      latest_at: latestAt,
    };
  });

  return NextResponse.json({ students: result });
}

function mergeAccounts(
  explicitAccounts: StudentLineAccount[],
  inferredAccounts: LineAccount[],
) {
  const byUserId = new Map<string, StudentLineAccount | LineAccount>();
  for (const account of inferredAccounts) byUserId.set(account.line_user_id, account);
  for (const account of explicitAccounts) byUserId.set(account.line_user_id, account);
  return [...byUserId.values()];
}
