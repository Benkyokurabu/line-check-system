import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { findLinkedLineUserId, normalizeStudentName, type LineAlias } from "@/lib/student-linking";
import { canonicalTeacherName } from "@/lib/teacher-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StudentRow = {
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
  const search = normalizeStudentName(url.searchParams.get("q"));
  const teacher = canonicalTeacherName(url.searchParams.get("teacher")?.trim() ?? "");
  const grade = url.searchParams.get("grade")?.trim();
  const campus = url.searchParams.get("campus")?.trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 80), 200);
  const supabase = createSupabaseAdminClient();

  let studentQuery = supabase
    .from("student_roster")
    .select("student_number,grade,student_name,homeroom_teacher,campus,gender")
    .order("grade", { ascending: true })
    .order("student_number", { ascending: true })
    .limit(500);

  if (grade) studentQuery = studentQuery.eq("grade", grade);
  if (campus) studentQuery = studentQuery.eq("campus", campus);

  const [
    { data: students, error: studentsError },
    { data: aliases, error: aliasesError },
    { data: links, error: linksError },
  ] = await Promise.all([
    studentQuery,
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

  const studentRows = (students ?? []) as StudentRow[];
  const teacherOptions = Array.from(
    new Set(studentRows.map((student) => canonicalTeacherName(student.homeroom_teacher) || "未設定")),
  ).sort((a, b) => a.localeCompare(b, "ja"));
  const gradeOptions = Array.from(new Set(studentRows.map((student) => student.grade).filter(Boolean))).sort(compareGrade);
  const campusOptions = ["本校", "南教室"];

  const filtered = studentRows
    .filter((student) => {
      const studentTeacher = canonicalTeacherName(student.homeroom_teacher) || "未設定";
      if (teacher && studentTeacher !== teacher) return false;
      if (!search) return true;
      return (
        normalizeStudentName(student.student_name).includes(search) ||
        normalizeStudentName(student.student_number).includes(search) ||
        normalizeStudentName(studentTeacher).includes(search)
      );
    })
    .slice(0, limit);

  const studentNumbers = filtered.map((student) => student.student_number);
  const linkedUserIds = [
    ...new Set(
      filtered
        .map((student) => linkMap.get(student.student_number) ?? findLinkedLineUserId(student.student_name, aliasRows))
        .filter((id): id is string => !!id),
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
    const lineUserId = linkMap.get(student.student_number) ?? findLinkedLineUserId(student.student_name, aliasRows);
    const stat = lineUserId ? messageStats.get(lineUserId) : null;
    return {
      ...student,
      homeroom_teacher: canonicalTeacherName(student.homeroom_teacher),
      line_user_id: lineUserId,
      line_message_count: stat?.count ?? 0,
      latest_line_at: stat?.latest_at ?? null,
      interaction_count: interactionCounts.get(student.student_number) ?? 0,
      survey_count: surveyCounts.get(student.student_number) ?? 0,
    };
  });

  return NextResponse.json({ students: result, teachers: teacherOptions, grades: gradeOptions, campuses: campusOptions });
}

function countByStudent(rows: CountRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.student_number) continue;
    counts.set(row.student_number, (counts.get(row.student_number) ?? 0) + 1);
  }
  return counts;
}


function compareGrade(a: string, b: string) {
  const order = ["小1", "小2", "小3", "小4", "小5", "小6", "中1", "中2", "中3", "高1", "高2", "高3", "既卒"];
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  return a.localeCompare(b, "ja", { numeric: true });
}

