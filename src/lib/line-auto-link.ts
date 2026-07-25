import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { relationFromAliasName } from "@/lib/student-linking";

type SavedLineMessage = {
  id: string;
  line_user_id: string;
  display_name: string | null;
  text: string | null;
};

type RosterRow = {
  student_number: string;
  student_name: string;
};

type LineAliasRow = {
  line_user_id: string;
  alias_name: string | null;
};

type StudentLineAccountRow = {
  student_number: string;
  line_user_id: string;
};

type StudentLineLinkRow = {
  student_number: string;
  line_user_id: string;
};

type LinkCandidate = {
  student: RosterRow;
  score: number;
  relation: "student" | "mother" | "father" | "guardian" | "family" | "unknown";
  aliasName: string | null;
  source: string;
};

function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ \t\r\n\u3000]/g, "")
    .replace(/[・･.。､,，、]/g, "")
    .replace(/(さん|様|くん|君|ちゃん)$/g, "")
    .replace(/(お父様|お母様|お父さん|お母さん|保護者|父|母)$/g, "");
}

function splitStudentName(studentName: string) {
  const normalized = normalizeName(studentName);
  if (normalized.length < 3) return null;

  return {
    fullName: normalized,
    surname: normalized.slice(0, 2),
    givenName: normalized.slice(2),
  };
}

function uniqueUserMessages(messages: SavedLineMessage[]) {
  const byUserId = new Map<string, SavedLineMessage[]>();
  for (const message of messages) {
    if (!byUserId.has(message.line_user_id)) byUserId.set(message.line_user_id, []);
    byUserId.get(message.line_user_id)!.push(message);
  }
  return byUserId;
}

function scoreFromRegisteredName(student: RosterRow, aliasName: string | null): LinkCandidate | null {
  const normalizedAlias = normalizeName(aliasName);
  const parts = splitStudentName(student.student_name);
  if (!normalizedAlias || !parts) return null;

  if (normalizedAlias === parts.fullName || normalizedAlias.includes(parts.fullName)) {
    return {
      student,
      score: 220,
      relation: relationFromAliasName(aliasName),
      aliasName,
      source: "line_registered_name",
    };
  }

  if (
    parts.surname.length >= 2 &&
    parts.givenName.length >= 2 &&
    normalizedAlias.includes(parts.surname) &&
    normalizedAlias.includes(parts.givenName)
  ) {
    return {
      student,
      score: 180,
      relation: relationFromAliasName(aliasName),
      aliasName,
      source: "line_registered_name_parts",
    };
  }

  return null;
}

function scoreFromDisplayAndText(
  student: RosterRow,
  displayName: string | null,
  text: string,
): LinkCandidate | null {
  const normalizedDisplay = normalizeName(displayName);
  const normalizedText = normalizeName(text);
  const parts = splitStudentName(student.student_name);
  if (!normalizedDisplay || !normalizedText || !parts) return null;

  if (
    parts.surname.length >= 2 &&
    parts.givenName.length >= 2 &&
    normalizedDisplay.includes(parts.surname) &&
    normalizedText.includes(parts.givenName)
  ) {
    return {
      student,
      score: 160,
      relation: "guardian",
      aliasName: displayName,
      source: "line_display_surname_and_message_given_name",
    };
  }

  return null;
}

function chooseCandidate(candidates: LinkCandidate[]) {
  const ranked = candidates
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => candidate.score >= 150);
  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  if (!top) return null;
  if (second && top.score - second.score < 40) return null;
  return top;
}

export async function autoLinkLineSenders(
  supabase: SupabaseClient,
  messages: SavedLineMessage[],
) {
  const messagesByUser = uniqueUserMessages(messages.filter((message) => message.line_user_id));
  const userIds = [...messagesByUser.keys()];
  if (userIds.length === 0) return { attempted: 0, linked: 0 };

  const [
    { data: roster, error: rosterError },
    { data: aliases, error: aliasError },
    { data: legacyLinks, error: legacyError },
    accountsResult,
  ] = await Promise.all([
    supabase.from("student_roster").select("student_number,student_name"),
    supabase.from("line_user_aliases").select("line_user_id,alias_name").in("line_user_id", userIds),
    supabase.from("student_line_links").select("student_number,line_user_id"),
    supabase.from("student_line_accounts").select("student_number,line_user_id").in("line_user_id", userIds),
  ]);

  if (rosterError) throw rosterError;
  if (aliasError) throw aliasError;
  if (legacyError) throw legacyError;
  if (accountsResult.error) {
    if (["42P01", "PGRST205"].includes(accountsResult.error.code ?? "")) {
      return { attempted: userIds.length, linked: 0, skipped: "student_line_accounts_missing" };
    }
    throw accountsResult.error;
  }

  const rosterRows = (roster ?? []) as RosterRow[];
  const aliasesByUser = new Map<string, LineAliasRow[]>();
  for (const alias of (aliases ?? []) as LineAliasRow[]) {
    if (!aliasesByUser.has(alias.line_user_id)) aliasesByUser.set(alias.line_user_id, []);
    aliasesByUser.get(alias.line_user_id)!.push(alias);
  }

  const linkedLineUserIds = new Set([
    ...((legacyLinks ?? []) as StudentLineLinkRow[]).map((link) => link.line_user_id),
    ...((accountsResult.data ?? []) as StudentLineAccountRow[]).map((account) => account.line_user_id),
  ]);
  const legacyStudents = new Set(
    ((legacyLinks ?? []) as StudentLineLinkRow[]).map((link) => link.student_number),
  );

  const now = new Date().toISOString();
  const upserts = [];

  for (const [lineUserId, userMessages] of messagesByUser.entries()) {
    if (linkedLineUserIds.has(lineUserId)) continue;

    const displayName = userMessages.find((message) => message.display_name)?.display_name ?? null;
    const joinedText = userMessages.map((message) => message.text ?? "").join("\n");
    const candidates = rosterRows.flatMap((student) => {
      const fromText = scoreFromDisplayAndText(student, displayName, joinedText);
      const fromAliases = (aliasesByUser.get(lineUserId) ?? [])
        .map((alias) => scoreFromRegisteredName(student, alias.alias_name))
        .filter((candidate): candidate is LinkCandidate => candidate !== null);
      return [fromText, ...fromAliases].filter((candidate): candidate is LinkCandidate => candidate !== null);
    });
    const candidate = chooseCandidate(candidates);
    if (!candidate) continue;

    const isPrimary = candidate.relation === "mother" || candidate.relation === "guardian";
    upserts.push({
      student_number: candidate.student.student_number,
      line_user_id: lineUserId,
      relation: candidate.relation,
      alias_name: candidate.aliasName,
      friend_display_name: displayName,
      source: candidate.source,
      is_primary: isPrimary,
      updated_at: now,
    });

    if (!legacyStudents.has(candidate.student.student_number) && isPrimary) {
      legacyStudents.add(candidate.student.student_number);
      await supabase.from("student_line_links").upsert(
        {
          student_number: candidate.student.student_number,
          line_user_id: lineUserId,
          updated_at: now,
        },
        { onConflict: "student_number" },
      );
    }
  }

  if (upserts.length === 0) return { attempted: userIds.length, linked: 0 };

  const { error } = await supabase
    .from("student_line_accounts")
    .upsert(upserts, { onConflict: "student_number,line_user_id" });
  if (error) throw error;

  return { attempted: userIds.length, linked: upserts.length };
}
