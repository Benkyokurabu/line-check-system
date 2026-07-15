import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { findLinkedLineAccounts, findLinkedLineUserId, selectPreferredLineUserId, type LineAlias } from "@/lib/student-linking";
import { canonicalTeacherName } from "@/lib/teacher-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ studentNumber: string }> },
) {
  const { studentNumber } = await context.params;
  const supabase = createSupabaseAdminClient();

  const { data: student, error: studentError } = await supabase
    .from("student_roster")
    .select("student_number,grade,student_name,homeroom_teacher")
    .eq("student_number", studentNumber)
    .maybeSingle();

  if (studentError) {
    return NextResponse.json({ error: studentError.message }, { status: 500 });
  }
  if (!student) {
    return NextResponse.json({ error: "student not found" }, { status: 404 });
  }

  const [
    { data: link, error: linkError },
    { data: aliases, error: aliasesError },
    { data: accounts, error: accountsError },
  ] = await Promise.all([
    supabase
      .from("student_line_links")
      .select("line_user_id")
      .eq("student_number", studentNumber)
      .maybeSingle(),
    supabase.from("line_user_aliases").select("line_user_id,alias_name"),
    supabase
      .from("student_line_accounts")
      .select("line_user_id,relation,alias_name,friend_display_name,is_primary")
      .eq("student_number", studentNumber),
  ]);

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }
  if (aliasesError) {
    return NextResponse.json({ error: aliasesError.message }, { status: 500 });
  }
  if (accountsError && !["42P01", "PGRST205"].includes(accountsError.code)) {
    return NextResponse.json({ error: accountsError.message }, { status: 500 });
  }

  const explicitAccounts = (accounts ?? []) as {
    line_user_id: string;
    relation: string;
    alias_name: string | null;
    friend_display_name: string | null;
    is_primary: boolean;
  }[];
  const inferredAccounts = findLinkedLineAccounts(student.student_name as string, (aliases ?? []) as LineAlias[]);
  const lineAccounts = mergeAccounts(explicitAccounts, inferredAccounts);
  const lineUserId =
    selectPreferredLineUserId(explicitAccounts) ??
    (link?.line_user_id as string | undefined) ??
    selectPreferredLineUserId(inferredAccounts) ??
    findLinkedLineUserId(student.student_name as string, (aliases ?? []) as LineAlias[]);
  const lineUserIds = [
    ...lineAccounts.map((account) => account.line_user_id),
    ...(lineUserId ? [lineUserId] : []),
  ].filter((id, index, ids) => ids.indexOf(id) === index);

  if (lineUserIds.length === 0) {
    return NextResponse.json({
      student: {
        ...student,
        homeroom_teacher: canonicalTeacherName(student.homeroom_teacher as string),
      },
      line_user_id: null,
      line_accounts: [],
      messages: [],
      link_status: "not_linked",
    });
  }

  const { data: messages, error: messagesError } = await supabase
    .from("line_messages")
    .select("id,line_user_id,direction,text,message_type,received_at,created_at,sent_by")
    .in("line_user_id", lineUserIds)
    .order("received_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(300);

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  return NextResponse.json({
    student: {
      ...student,
      homeroom_teacher: canonicalTeacherName(student.homeroom_teacher as string),
    },
    line_user_id: lineUserId,
    line_user_ids: lineUserIds,
    line_accounts: lineAccounts,
    messages: messages ?? [],
    link_status: "linked",
  });
}

function mergeAccounts<T extends { line_user_id: string }>(
  explicitAccounts: T[],
  inferredAccounts: T[],
) {
  const byUserId = new Map<string, T>();
  for (const account of inferredAccounts) byUserId.set(account.line_user_id, account);
  for (const account of explicitAccounts) byUserId.set(account.line_user_id, account);
  return [...byUserId.values()];
}
