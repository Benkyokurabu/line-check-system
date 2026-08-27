import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { normalizeStudentName } from "@/lib/student-linking";

export const dynamic = "force-dynamic";

type RosterRow = {
  student_number: string;
  student_name: string;
  grade: string;
  campus: string | null;
  homeroom_teacher: string | null;
};

type PendingCandidateRow = {
  id: string;
  student_number: string | null;
  suggested_student_name: string | null;
  status: string;
  created_at: string;
  line_messages: LineMessageRelation | LineMessageRelation[] | null;
};

type LineAccountRow = {
  line_user_id: string;
  student_number: string;
  relation: string;
  alias_name: string | null;
  friend_display_name: string | null;
};

type LineMessageRelation = {
  line_user_id: string | null;
  display_name: string | null;
  text: string | null;
  received_at: string | null;
};

type LineLinkEvidenceRow = {
  line_user_id: string;
  manager_line_user_id: string | null;
  display_name: string | null;
  manager_alias_name: string | null;
  evidence_text: string;
  evidence_at: string | null;
  parsed_student_name: string | null;
  relation: string;
  source: string;
  review_status: "pending" | "confirmed" | "rejected";
  reviewed_at: string | null;
  detected_message_id: string | null;
  verified_at: string | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeName(value: string | null | undefined) {
  return normalizeStudentName(value)
    .replace(/(さん|様|くん|君|ちゃん)$/g, "")
    .toLowerCase();
}

function shortLineId(value: string) {
  if (value === "attendance_demo") return "demo";
  return value.length > 8 ? value.slice(-5) : value;
}

function campusPrefix(value: string | null | undefined) {
  return value?.includes("南") ? "南" : "本";
}

function compactStudentName(value: string) {
  return value.normalize("NFKC").replace(/[\s　]/g, "");
}

function scoreStudent(input: {
  student: RosterRow;
  text: string;
  displayName: string;
  suggestedNames: string[];
  linkedStudentNumbers: Set<string>;
  sameDisplayAccounts: LineAccountRow[];
  identityEvidence: LineLinkEvidenceRow | null;
}) {
  const student = normalizeName(input.student.student_name);
  if (!student) return null;
  const surname = student.slice(0, 2);
  const givenName = student.slice(2);
  const text = normalizeName(input.text);
  const displayName = normalizeName(input.displayName);
  const suggested = input.suggestedNames.map(normalizeName).filter(Boolean);
  const evidenceText = normalizeName(input.identityEvidence?.evidence_text);
  const evidenceStudentName = normalizeName(input.identityEvidence?.parsed_student_name);
  const evidenceManagerAlias = normalizeName(input.identityEvidence?.manager_alias_name);
  let score = 0;
  const reasons: string[] = [];

  if (evidenceStudentName && evidenceStudentName === student) {
    score += 180;
    reasons.push("初回自己申告に生徒名");
  } else if (evidenceText && evidenceText.includes(student)) {
    score += 170;
    reasons.push("初回自己申告に生徒名");
  } else if (evidenceManagerAlias && (
    evidenceManagerAlias.includes(student) ||
    (surname && givenName && evidenceManagerAlias.includes(surname) && evidenceManagerAlias.includes(givenName))
  )) {
    score += 140;
    reasons.push("初回自己申告とLINE管理名");
  }

  if (input.linkedStudentNumbers.has(input.student.student_number)) {
    score += 100;
    reasons.push("候補で確定済み");
  }
  if (text.includes(student)) {
    score += 95;
    reasons.push("本文にフルネーム");
  } else if (surname && givenName && text.includes(surname) && text.includes(givenName)) {
    score += 82;
    reasons.push("本文に姓名");
  } else if (surname && text.includes(surname)) {
    score += 38;
    reasons.push("本文に姓");
  }
  if (suggested.some((value) => value === student || value.includes(student))) {
    score += 90;
    reasons.push("AI候補名");
  } else if (suggested.some((value) => surname && value.includes(surname))) {
    score += 34;
    reasons.push("AI候補に姓");
  }
  if (displayName && (displayName === student || displayName.includes(student))) {
    score += 88;
    reasons.push("LINE表示名に生徒名");
  } else if (displayName && givenName && displayName === givenName) {
    score += 62;
    reasons.push("LINE表示名が名");
  }
  for (const account of input.sameDisplayAccounts) {
    const alias = normalizeName(account.alias_name);
    if (alias.includes(student)) {
      score += 78;
      reasons.push("同じ表示名の管理名");
      break;
    }
  }
  if (score <= 0) return null;
  return {
    ...input.student,
    score,
    reason: [...new Set(reasons)].join(" / "),
    proposed_alias_name: `${campusPrefix(input.student.campus)}　${compactStudentName(input.student.student_name)}`,
  };
}

export async function GET() {
  const supabase = createSupabaseAdminClient();
  const [{ data: candidates, error }, { data: roster, error: rosterError }, accountsResult, legacyLinksResult, { data: aliases, error: aliasesError }, evidenceResult] = await Promise.all([
    supabase
      .from("attendance_candidates")
      .select("id,student_number,suggested_student_name,status,created_at,line_messages(line_user_id,display_name,text,received_at)")
      .in("status", ["pending", "notion_failed"])
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("student_roster")
      .select("student_number,student_name,grade,campus,homeroom_teacher"),
    supabase
      .from("student_line_accounts")
      .select("line_user_id,student_number,relation,alias_name,friend_display_name"),
    supabase
      .from("student_line_links")
      .select("line_user_id"),
    supabase
      .from("line_user_aliases")
      .select("line_user_id,alias_name"),
    supabase
      .from("line_link_evidence")
      .select("line_user_id,manager_line_user_id,display_name,manager_alias_name,evidence_text,evidence_at,parsed_student_name,relation,source,review_status,reviewed_at,detected_message_id,verified_at"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (rosterError) return NextResponse.json({ error: rosterError.message }, { status: 500 });
  if (accountsResult.error && !["42P01", "PGRST205"].includes(accountsResult.error.code ?? "")) {
    return NextResponse.json({ error: accountsResult.error.message }, { status: 500 });
  }
  if (legacyLinksResult.error) return NextResponse.json({ error: legacyLinksResult.error.message }, { status: 500 });
  if (aliasesError) return NextResponse.json({ error: aliasesError.message }, { status: 500 });
  if (evidenceResult.error && !["42P01", "PGRST205"].includes(evidenceResult.error.code ?? "")) {
    return NextResponse.json({ error: evidenceResult.error.message }, { status: 500 });
  }

  const accountRows = (accountsResult.data ?? []) as LineAccountRow[];
  const linkedLineUserIds = new Set([
    ...accountRows.map((row) => row.line_user_id),
    ...(legacyLinksResult.data ?? []).map((row) => row.line_user_id as string),
  ]);
  const aliasUserIds = new Set((aliases ?? []).filter((row) => row.alias_name?.trim()).map((row) => row.line_user_id as string));
  const accountAliasUserIds = new Set(accountRows.filter((row) => row.alias_name?.trim()).map((row) => row.line_user_id));
  const evidenceByLineUserId = new Map(
    ((evidenceResult.data ?? []) as LineLinkEvidenceRow[]).map((row) => [row.line_user_id, row]),
  );
  const rowsByLineUserId = new Map<string, PendingCandidateRow[]>();
  for (const row of (candidates ?? []) as PendingCandidateRow[]) {
    const lineMessage = firstRelation(row.line_messages);
    const lineUserId = lineMessage?.line_user_id;
    const pendingEvidence = lineUserId ? evidenceByLineUserId.get(lineUserId)?.review_status === "pending" : false;
    if (!lineUserId || linkedLineUserIds.has(lineUserId)) continue;
    if (!pendingEvidence && (aliasUserIds.has(lineUserId) || accountAliasUserIds.has(lineUserId))) continue;
    if (!rowsByLineUserId.has(lineUserId)) rowsByLineUserId.set(lineUserId, []);
    rowsByLineUserId.get(lineUserId)!.push(row);
  }
  for (const evidence of evidenceByLineUserId.values()) {
    if (evidence.review_status !== "pending" || linkedLineUserIds.has(evidence.line_user_id)) continue;
    if (!rowsByLineUserId.has(evidence.line_user_id)) rowsByLineUserId.set(evidence.line_user_id, []);
  }

  const rosterRows = (roster ?? []) as RosterRow[];
  const items = [...rowsByLineUserId.entries()].map(([lineUserId, rows]) => {
    const sorted = [...rows].sort((a, b) => {
      const aLineMessage = firstRelation(a.line_messages);
      const bLineMessage = firstRelation(b.line_messages);
      const aTime = Date.parse(aLineMessage?.received_at ?? a.created_at ?? "");
      const bTime = Date.parse(bLineMessage?.received_at ?? b.created_at ?? "");
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    });
    const latest = sorted[0];
    const latestLineMessage = firstRelation(latest?.line_messages);
    const identityEvidence = evidenceByLineUserId.get(lineUserId) ?? null;
    const displayName = latestLineMessage?.display_name ?? identityEvidence?.display_name ?? "";
    const suggestedNames = [...new Set(sorted.map((row) => row.suggested_student_name).filter((value): value is string => Boolean(value?.trim())))];
    const linkedStudentNumbers = new Set(sorted.map((row) => row.student_number).filter((value): value is string => Boolean(value)));
    const sameDisplayAccounts = displayName
      ? accountRows.filter((row) => row.friend_display_name?.trim() === displayName && row.alias_name?.trim())
      : [];
    const text = sorted.length > 0
      ? sorted.map((row) => firstRelation(row.line_messages)?.text ?? "").join("\n")
      : identityEvidence?.evidence_text ?? "";
    const suggestions = rosterRows
      .map((student) => scoreStudent({ student, text, displayName, suggestedNames, linkedStudentNumbers, sameDisplayAccounts, identityEvidence }))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    const top = suggestions[0] ?? null;
    return {
      line_user_id: lineUserId,
      line_user_id_short: shortLineId(lineUserId),
      display_name: displayName || null,
      latest_received_at: latestLineMessage?.received_at ?? identityEvidence?.evidence_at ?? null,
      candidate_count: sorted.length,
      suggested_names: suggestedNames,
      latest_text: latestLineMessage?.text ?? identityEvidence?.evidence_text ?? null,
      identity_evidence: identityEvidence,
      suggestions,
      default_student_number: top?.student_number ?? "",
      default_relation: identityEvidence?.relation && identityEvidence.relation !== "unknown"
        ? identityEvidence.relation
        : top && normalizeName(displayName) === normalizeName(top.student_name).slice(2) ? "student" : "mother",
    };
  }).sort((a, b) => {
    const aTime = Date.parse(a.latest_received_at ?? "");
    const bTime = Date.parse(b.latest_received_at ?? "");
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });

  return NextResponse.json({ candidates: items });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const lineUserId = typeof body.line_user_id === "string" ? body.line_user_id.trim() : "";
  if (!lineUserId) {
    return NextResponse.json({ error: "line_user_id is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await createSupabaseAdminClient()
    .from("line_link_evidence")
    .update({ review_status: "rejected", reviewed_at: now, updated_at: now })
    .eq("line_user_id", lineUserId)
    .eq("review_status", "pending")
    .select("line_user_id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "確認待ち候補が見つかりません" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

