import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type RosterRow = {
  student_number: string;
  student_name: string;
  grade: string;
  campus: string | null;
};

type LineMessageRow = {
  line_user_id: string | null;
  display_name: string | null;
};

type StudentSuggestion = RosterRow & {
  score: number;
  reason: string;
};

type LineAccountRow = {
  student_number: string;
  line_user_id: string;
  relation: string;
  alias_name: string | null;
  friend_display_name: string | null;
  is_primary: boolean;
};

type SenderProfile = {
  display_name: string | null;
  alias_names: string[];
  account_names: string[];
};

function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[ \t\r\n\u3000]/g, "")
    .replace(/(さん|様|くん|君|ちゃん)$/g, "")
    .replace(/(父|母|保護者|お父様|お母様)$/g, "")
    .toLowerCase();
}

function uniqueFilled(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function addSuggestion(
  suggestions: Map<string, StudentSuggestion>,
  rosterByNumber: Map<string, RosterRow>,
  studentNumber: string | null | undefined,
  score: number,
  reason: string,
) {
  if (!studentNumber) return;
  const student = rosterByNumber.get(studentNumber);
  if (!student) return;
  const current = suggestions.get(studentNumber);
  if (!current || current.score < score) {
    suggestions.set(studentNumber, { ...student, score, reason });
  }
}

function buildStudentSuggestions(input: {
  currentStudentNumber: string | null;
  suggestedStudentName: string | null;
  lineMessage: LineMessageRow | null;
  roster: RosterRow[];
  accountsByLineUserId: Map<string, LineAccountRow[]>;
  linksByLineUserId: Map<string, string[]>;
  aliases: { line_user_id: string; alias_name: string | null }[];
}) {
  const rosterByNumber = new Map(input.roster.map((student) => [student.student_number, student]));
  const suggestions = new Map<string, StudentSuggestion>();
  const lineUserId = input.lineMessage?.line_user_id;
  if (input.currentStudentNumber) {
    addSuggestion(suggestions, rosterByNumber, input.currentStudentNumber, 100, "現在選択中");
  }

  for (const account of lineUserId ? input.accountsByLineUserId.get(lineUserId) ?? [] : []) {
    const score = account.is_primary ? 98 : account.relation === "mother" || account.relation === "guardian" ? 96 : 92;
    addSuggestion(suggestions, rosterByNumber, account.student_number, score, "LINE連携");
  }
  for (const studentNumber of lineUserId ? input.linksByLineUserId.get(lineUserId) ?? [] : []) {
    addSuggestion(suggestions, rosterByNumber, studentNumber, 94, "LINE履歴");
  }

  const searchTexts = [
    input.suggestedStudentName,
    input.lineMessage?.display_name,
    ...input.aliases.filter((alias) => alias.line_user_id === lineUserId).map((alias) => alias.alias_name),
  ]
    .map(normalizeName)
    .filter(Boolean);

  for (const student of input.roster) {
    const normalizedStudent = normalizeName(student.student_name);
    if (!normalizedStudent) continue;
    for (const text of searchTexts) {
      if (text === normalizedStudent) {
        addSuggestion(suggestions, rosterByNumber, student.student_number, 90, "名前一致");
      } else if (text.includes(normalizedStudent)) {
        addSuggestion(suggestions, rosterByNumber, student.student_number, 84, "送信者名に生徒名");
      } else {
        const surname = normalizedStudent.slice(0, 2);
        const givenName = normalizedStudent.slice(2);
        if (surname && givenName && text.includes(surname) && text.includes(givenName)) {
          addSuggestion(suggestions, rosterByNumber, student.student_number, 78, "送信者名に姓名の一部");
        }
      }
    }
  }

  return [...suggestions.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

function buildSenderProfile(input: {
  lineMessage: LineMessageRow | null;
  accounts: LineAccountRow[];
  aliases: { line_user_id: string; alias_name: string | null }[];
}): SenderProfile {
  const lineUserId = input.lineMessage?.line_user_id;
  const lineAliases = lineUserId ? input.aliases.filter((alias) => alias.line_user_id === lineUserId) : [];
  return {
    display_name: input.lineMessage?.display_name ?? null,
    alias_names: uniqueFilled(lineAliases.map((alias) => alias.alias_name)),
    account_names: uniqueFilled(input.accounts.flatMap((account) => [account.alias_name, account.friend_display_name])),
  };
}

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  const supabase = createSupabaseAdminClient();
  const [{ data, error }, { data: roster }, { data: accounts }, { data: links }, { data: aliases }] = await Promise.all([
    supabase
      .from("attendance_candidates")
      .select("*,student_roster(student_name,grade,campus,homeroom_teacher),lessons(label,lesson_date,start_time,campus),line_messages(text,received_at,display_name,line_user_id)")
      .in("status", status === "pending" ? ["pending", "notion_failed"] : [status])
      .order("created_at", { ascending: false }),
    supabase.from("student_roster").select("student_number,student_name,grade,campus,homeroom_teacher"),
    supabase.from("student_line_accounts").select("student_number,line_user_id,relation,alias_name,friend_display_name,is_primary"),
    supabase.from("student_line_links").select("student_number,line_user_id"),
    supabase.from("line_user_aliases").select("line_user_id,alias_name"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rosterRows = (roster ?? []) as RosterRow[];
  const accountsByLineUserId = new Map<string, LineAccountRow[]>();
  for (const account of accounts ?? []) {
    const lineUserId = account.line_user_id as string;
    if (!accountsByLineUserId.has(lineUserId)) accountsByLineUserId.set(lineUserId, []);
    accountsByLineUserId.get(lineUserId)!.push(account as LineAccountRow);
  }
  const linksByLineUserId = new Map<string, string[]>();
  for (const link of links ?? []) {
    const lineUserId = link.line_user_id as string;
    if (!linksByLineUserId.has(lineUserId)) linksByLineUserId.set(lineUserId, []);
    linksByLineUserId.get(lineUserId)!.push(link.student_number as string);
  }
  const aliasRows = (aliases ?? []) as { line_user_id: string; alias_name: string | null }[];
  const candidates = (data ?? []).map((candidate) => {
    const lineMessage = (candidate.line_messages as LineMessageRow | null) ?? null;
    const linkedAccounts = lineMessage?.line_user_id ? accountsByLineUserId.get(lineMessage.line_user_id) ?? [] : [];
    return {
      ...candidate,
      sender_profile: buildSenderProfile({ lineMessage, accounts: linkedAccounts, aliases: aliasRows }),
      student_suggestions: buildStudentSuggestions({
        currentStudentNumber: (candidate.student_number as string | null) ?? null,
        suggestedStudentName: (candidate.suggested_student_name as string | null) ?? null,
        lineMessage,
        roster: rosterRows,
        accountsByLineUserId,
        linksByLineUserId,
        aliases: aliasRows,
      }),
    };
  });
  return NextResponse.json({ candidates });
}
