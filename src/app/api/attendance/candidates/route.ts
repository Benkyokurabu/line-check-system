import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type RosterRow = {
  student_number: string;
  student_name: string;
  grade: string;
  campus: string | null;
  homeroom_teacher: string | null;
};

type LineMessageRow = {
  line_user_id: string | null;
  display_name: string | null;
  received_at: string | null;
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

type AttendanceReplyRow = {
  id: string;
  text: string | null;
  received_at: string | null;
  sent_by: string | null;
  raw_event: { attendance_candidate_id?: string } | null;
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
  aliases: { line_user_id: string; alias_name: string | null; group_name?: string | null }[];
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
  aliases: { line_user_id: string; alias_name: string | null; group_name?: string | null }[];
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
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "5") || 5, 1), 14);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createSupabaseAdminClient();
  const candidateSelect = "*,student_roster(student_name,grade,campus,homeroom_teacher),lessons(label,lesson_date,start_time,campus),attendance_candidate_items(*,lessons(label,lesson_date,start_time,campus,source_payload)),line_messages(text,received_at,display_name,line_user_id)";
  const openCandidateQuery = supabase
    .from("attendance_candidates")
    .select(candidateSelect)
    .in("status", ["pending", "notion_failed"])
    .order("created_at", { ascending: false });
  const doneCandidateQuery = supabase
    .from("attendance_candidates")
    .select(candidateSelect)
    .in("status", ["confirmed", "dismissed"])
    .gte("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(120);
  const candidateQuery = status === "review"
    ? Promise.all([openCandidateQuery, doneCandidateQuery]).then(([openResult, doneResult]) => ({
        data: [...(openResult.data ?? []), ...(doneResult.data ?? [])],
        error: openResult.error ?? doneResult.error,
      }))
    : status === "done"
      ? doneCandidateQuery
      : status === "pending"
        ? openCandidateQuery
        : supabase
            .from("attendance_candidates")
            .select(candidateSelect)
            .in("status", [status])
            .order("created_at", { ascending: false });

  const [{ data, error }, { data: roster }, { data: accounts }, { data: links }, { data: aliases }] = await Promise.all([
    candidateQuery,
    supabase.from("student_roster").select("student_number,student_name,grade,campus,homeroom_teacher"),
    supabase.from("student_line_accounts").select("student_number,line_user_id,relation,alias_name,friend_display_name,is_primary"),
    supabase.from("student_line_links").select("student_number,line_user_id"),
    supabase.from("line_user_aliases").select("line_user_id,alias_name,group_name"),
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
  const aliasRows = (aliases ?? []) as { line_user_id: string; alias_name: string | null; group_name: string | null }[];
  const candidateIds = (data ?? []).map((candidate) => candidate.id as string);
  const { data: replies, error: repliesError } = candidateIds.length > 0 ? await supabase
    .from("line_messages")
    .select("id,text,received_at,sent_by,raw_event")
    .eq("direction", "outbound")
    .eq("raw_event->>send_context", "attendance_candidate_reply")
    .order("received_at", { ascending: false })
    .limit(1000) : { data: [], error: null };
  if (repliesError) return NextResponse.json({ error: repliesError.message }, { status: 500 });
  const repliesByCandidateId = new Map<string, AttendanceReplyRow[]>();
  for (const reply of (replies ?? []) as AttendanceReplyRow[]) {
    const candidateId = reply.raw_event?.attendance_candidate_id;
    if (!candidateId || !candidateIds.includes(candidateId)) continue;
    if (!repliesByCandidateId.has(candidateId)) repliesByCandidateId.set(candidateId, []);
    repliesByCandidateId.get(candidateId)!.push(reply);
  }

  const candidates = (data ?? []).map((candidate) => {
    const lineMessage = (candidate.line_messages as LineMessageRow | null) ?? null;
    const linkedAccounts = lineMessage?.line_user_id ? accountsByLineUserId.get(lineMessage.line_user_id) ?? [] : [];
    return {
      ...candidate,
      sender_profile: buildSenderProfile({ lineMessage, accounts: linkedAccounts, aliases: aliasRows }),
      reply_messages: repliesByCandidateId.get(candidate.id as string) ?? [],
      reply_status: (() => {
        const candidateReplies = repliesByCandidateId.get(candidate.id as string) ?? [];
        const latestReply = candidateReplies[0] ?? null;
        return {
          sent: candidateReplies.length > 0,
          count: candidateReplies.length,
          last_sent_at: latestReply?.received_at ?? null,
          last_sent_by: latestReply?.sent_by ?? null,
        };
      })(),
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
  candidates.sort((a, b) => {
    const aMessage = (a.line_messages as LineMessageRow | null) ?? null;
    const bMessage = (b.line_messages as LineMessageRow | null) ?? null;
    const aTime = Date.parse(aMessage?.received_at ?? (a.created_at as string | null) ?? "");
    const bTime = Date.parse(bMessage?.received_at ?? (b.created_at as string | null) ?? "");
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });
  return NextResponse.json({ candidates });
}




