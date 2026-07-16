import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { findLinkedLineAccounts, findLinkedLineUserId, normalizeStudentName, selectPreferredLineUserId, type LineAccount, type LineAlias } from "@/lib/student-linking";
import { canonicalTeacherName } from "@/lib/teacher-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StudentRow = {
  student_number: string;
  grade: string;
  student_name: string;
  homeroom_teacher: string;
  campus: string | null;
  school_name: string | null;
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

type MessageStatRow = {
  line_user_id: string;
  received_at: string | null;
  created_at: string | null;
};

type CountRow = {
  student_number: string | null;
};

async function optionalSelect<T>(
  query: PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
) {
  const { data, error } = await query;
  if (error) return [] as T[];
  return data ?? [];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawSearch = url.searchParams.get("q") ?? "";
  const search = normalizeStudentName(rawSearch);
  const teacher = canonicalTeacherName(url.searchParams.get("teacher")?.trim() ?? "");
  const grade = url.searchParams.get("grade")?.trim();
  const campus = url.searchParams.get("campus")?.trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 80), 200);
  const supabase = createSupabaseAdminClient();

  const studentQuery = supabase
    .from("student_roster")
    .select("student_number,grade,student_name,homeroom_teacher,campus,school_name,gender")
    .order("grade", { ascending: true })
    .order("student_number", { ascending: true })
    .limit(5000);

  const [
    { data: students, error: studentsError },
    { data: aliases, error: aliasesError },
    { data: links, error: linksError },
    { data: accounts, error: accountsError },
  ] = await Promise.all([
    studentQuery,
    supabase.from("line_user_aliases").select("line_user_id,alias_name"),
    supabase.from("student_line_links").select("student_number,line_user_id"),
    supabase
      .from("student_line_accounts")
      .select("student_number,line_user_id,relation,alias_name,friend_display_name,is_primary"),
  ]);

  if (studentsError) return NextResponse.json({ error: studentsError.message }, { status: 500 });
  if (aliasesError) return NextResponse.json({ error: aliasesError.message }, { status: 500 });
  if (linksError) return NextResponse.json({ error: linksError.message }, { status: 500 });
  if (accountsError && !["42P01", "PGRST205"].includes(accountsError.code)) return NextResponse.json({ error: accountsError.message }, { status: 500 });

  const aliasRows = (aliases ?? []) as LineAlias[];
  const linkMap = new Map(
    ((links ?? []) as StudentLineLink[]).map((link) => [link.student_number, link.line_user_id]),
  );
  const accountsByStudent = new Map<string, StudentLineAccount[]>();
  for (const account of (accounts ?? []) as StudentLineAccount[]) {
    if (!accountsByStudent.has(account.student_number)) accountsByStudent.set(account.student_number, []);
    accountsByStudent.get(account.student_number)!.push(account);
  }

  const studentRows = (students ?? []) as StudentRow[];
  const teacherOptions = Array.from(
    new Set(studentRows.map((student) => canonicalTeacherName(student.homeroom_teacher) || "未設定")),
  ).sort((a, b) => a.localeCompare(b, "ja"));
  const gradeOptions = Array.from(new Set(studentRows.map((student) => student.grade).filter(Boolean))).sort(compareGrade);
  const campusOptions = ["本校", "南教室", "両方"];

  const filtered = studentRows
    .filter((student) => {
      const studentTeacher = canonicalTeacherName(student.homeroom_teacher) || "未設定";
      if (teacher && studentTeacher !== teacher) return false;
      if (grade && student.grade !== grade) return false;
      if (campus && student.campus !== campus) return false;
      if (!rawSearch.trim()) return true;
      const explicitAccounts = accountsByStudent.get(student.student_number) ?? [];
      const inferredAccounts = findLinkedLineAccounts(student.student_name, aliasRows);
      const searchTokens = rawSearch
        .split(/[\s\u3000]+/)
        .map(normalizeSearchToken)
        .filter(Boolean);
      const haystack = [
        student.student_name,
        student.student_number,
        studentTeacher,
        ...mergeAccounts(explicitAccounts, inferredAccounts).flatMap((account) => [
          account.alias_name,
          account.friend_display_name,
          relationLabel(account.relation),
        ]),
      ]
        .filter((value): value is string => Boolean(value))
        .map(normalizeStudentName)
        .join(" ");
      return (
        (Boolean(search) && (
          normalizeStudentName(student.student_name).includes(search) ||
          normalizeStudentName(student.student_number).includes(search) ||
          normalizeStudentName(studentTeacher).includes(search)
        )) ||
        searchTokens.every((token) => haystack.includes(token))
      );
    })
    .slice(0, limit);

  const studentNumbers = filtered.map((student) => student.student_number);
  const linkedUserIds = [
    ...new Set(
      filtered.flatMap((student) => {
        const explicitAccounts = accountsByStudent.get(student.student_number) ?? [];
        const inferredAccounts = findLinkedLineAccounts(student.student_name, aliasRows);
        const accountIds = [...explicitAccounts, ...inferredAccounts].map((account) => account.line_user_id);
        const fallback = linkMap.get(student.student_number) ?? findLinkedLineUserId(student.student_name, aliasRows);
        return [...accountIds, fallback].filter((id): id is string => !!id);
      }),
    ),
  ];

  const [messages, interactions, surveys] = await Promise.all([
    linkedUserIds.length > 0
      ? optionalSelect<MessageStatRow>(
          supabase
            .from("line_messages")
            .select("line_user_id,received_at,created_at")
            .in("line_user_id", linkedUserIds),
        )
      : Promise.resolve([]),
    studentNumbers.length > 0
      ? optionalSelect<CountRow>(
          supabase
            .from("student_interactions")
            .select("student_number")
            .in("student_number", studentNumbers),
        )
      : Promise.resolve([]),
    studentNumbers.length > 0
      ? optionalSelect<CountRow>(
          supabase
            .from("survey_responses")
            .select("student_number")
            .eq("visible_in_karte", true)
            .in("student_number", studentNumbers),
        )
      : Promise.resolve([]),
  ]);

  const messageStats = new Map<string, { count: number; latest_at: string | null }>();
  for (const message of messages) {
    const at = message.received_at ?? message.created_at;
    const current = messageStats.get(message.line_user_id) ?? { count: 0, latest_at: null };
    current.count += 1;
    if (at && (!current.latest_at || new Date(at).getTime() > new Date(current.latest_at).getTime())) {
      current.latest_at = at;
    }
    messageStats.set(message.line_user_id, current);
  }

  const interactionCounts = countByStudent(interactions);
  const surveyCounts = countByStudent(surveys);

  const result = filtered.map((student) => {
    const explicitAccounts = accountsByStudent.get(student.student_number) ?? [];
    const inferredAccounts = findLinkedLineAccounts(student.student_name, aliasRows);
    const lineAccounts = mergeAccounts(
      explicitAccounts,
      inferredAccounts,
    );
    const lineUserId =
      selectPreferredLineUserId(explicitAccounts) ??
      linkMap.get(student.student_number) ??
      selectPreferredLineUserId(inferredAccounts) ??
      findLinkedLineUserId(student.student_name, aliasRows);
    const accountStats = [
      ...lineAccounts.map((account) => account.line_user_id),
      ...(lineUserId ? [lineUserId] : []),
    ]
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .map((id) => messageStats.get(id))
      .filter((stat): stat is { count: number; latest_at: string | null } => Boolean(stat));
    const lineMessageCount = accountStats.reduce((total, stat) => total + stat.count, 0);
    const latestLineAt = accountStats
      .map((stat) => stat.latest_at)
      .filter((at): at is string => Boolean(at))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
    return {
      ...student,
      homeroom_teacher: canonicalTeacherName(student.homeroom_teacher),
      line_user_id: lineUserId,
      line_accounts: lineAccounts,
      line_account_count: lineAccounts.length,
      line_message_count: lineMessageCount,
      latest_line_at: latestLineAt,
      interaction_count: interactionCounts.get(student.student_number) ?? 0,
      survey_count: surveyCounts.get(student.student_number) ?? 0,
    };
  });

  return NextResponse.json({ students: result, teachers: teacherOptions, grades: gradeOptions, campuses: campusOptions });
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

function countByStudent(rows: CountRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.student_number) continue;
    counts.set(row.student_number, (counts.get(row.student_number) ?? 0) + 1);
  }
  return counts;
}


function normalizeSearchToken(value: string) {
  const normalized = normalizeStudentName(value);
  if (normalized) return normalized;
  return value.normalize("NFKC").replace(/[ \t\r\n\u3000]/g, "").trim();
}
function relationLabel(relation: string) {
  if (relation === "mother") return "母";
  if (relation === "father") return "父";
  if (relation === "guardian") return "保護者";
  if (relation === "family") return "家族";
  if (relation === "student") return "本人";
  return relation;
}
function compareGrade(a: string, b: string) {
  const order = ["小1", "小2", "小3", "小4", "小5", "小6", "中1", "中2", "中3", "高1", "高2", "高3", "既卒"];
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  return a.localeCompare(b, "ja", { numeric: true });
}

