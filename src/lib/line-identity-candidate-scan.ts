import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { detectExplicitLineIdentities } from "@/lib/line-identity-detection.mjs";

type RosterRow = {
  student_number: string;
  student_name: string;
};

type MessageRow = {
  id: string;
  line_user_id: string;
  display_name: string | null;
  text: string | null;
  received_at: string | null;
  created_at: string;
};

type Detection = {
  student_number: string;
  student_name: string;
  relation: string;
  message: MessageRow;
};

const LOOKBACK_HOURS = 48;

async function selectAll<T>(queryForRange: (from: number, to: number) => PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await queryForRange(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

export async function scanLineIdentityCandidates(input: {
  supabase: SupabaseClient;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const supabase = input.supabase;

  const [messages, roster, accounts, legacyLinks, evidence] = await Promise.all([
    selectAll<MessageRow>((from, to) => supabase
      .from("line_messages")
      .select("id,line_user_id,display_name,text,received_at,created_at")
      .eq("direction", "inbound")
      .eq("message_type", "text")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(from, to)),
    selectAll<RosterRow>((from, to) => supabase
      .from("student_roster")
      .select("student_number,student_name")
      .range(from, to)),
    selectAll<{ line_user_id: string }>((from, to) => supabase
      .from("student_line_accounts")
      .select("line_user_id")
      .range(from, to)),
    selectAll<{ line_user_id: string }>((from, to) => supabase
      .from("student_line_links")
      .select("line_user_id")
      .range(from, to)),
    selectAll<{ line_user_id: string }>((from, to) => supabase
      .from("line_link_evidence")
      .select("line_user_id")
      .range(from, to)),
  ]);

  const linkedLineUserIds = new Set([
    ...accounts.map((row) => row.line_user_id),
    ...legacyLinks.map((row) => row.line_user_id),
  ]);
  const existingEvidenceLineUserIds = new Set(evidence.map((row) => row.line_user_id));
  const detectionsByLineUserId = new Map<string, Detection[]>();
  const ambiguousMessageIds = new Set<string>();

  for (const message of messages) {
    if (!message.line_user_id || !message.text || linkedLineUserIds.has(message.line_user_id)) continue;
    const matches = detectExplicitLineIdentities(message.text, roster);
    if (matches.length !== 1) {
      if (matches.length > 1) ambiguousMessageIds.add(message.id);
      continue;
    }
    const rows = detectionsByLineUserId.get(message.line_user_id) ?? [];
    rows.push({ ...matches[0], message });
    detectionsByLineUserId.set(message.line_user_id, rows);
  }

  const pendingRows = [];
  let conflictingAccounts = 0;
  let existingEvidenceAccounts = 0;
  for (const [lineUserId, detections] of detectionsByLineUserId) {
    if (existingEvidenceLineUserIds.has(lineUserId)) {
      existingEvidenceAccounts += 1;
      continue;
    }
    const uniqueIdentities = new Set(detections.map((row) => `${row.student_number}|${row.relation}`));
    if (uniqueIdentities.size !== 1) {
      conflictingAccounts += 1;
      continue;
    }
    const latest = detections[detections.length - 1];
    pendingRows.push({
      line_user_id: lineUserId,
      manager_line_user_id: null,
      display_name: latest.message.display_name,
      manager_alias_name: null,
      evidence_text: latest.message.text!.slice(0, 1000),
      evidence_at: latest.message.received_at ?? latest.message.created_at,
      parsed_student_name: latest.student_name,
      relation: latest.relation,
      source: "auto_explicit_identity_candidate",
      review_status: "pending",
      reviewed_at: null,
      verified_at: null,
      detected_message_id: latest.message.id,
      updated_at: now.toISOString(),
    });
  }

  if (pendingRows.length > 0) {
    const { error } = await supabase
      .from("line_link_evidence")
      .upsert(pendingRows, { onConflict: "line_user_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  return {
    ok: true,
    lookback_hours: LOOKBACK_HOURS,
    scanned_messages: messages.length,
    matched_accounts: detectionsByLineUserId.size,
    created_candidates: pendingRows.length,
    ambiguous_messages: ambiguousMessageIds.size,
    conflicting_accounts: conflictingAccounts,
    existing_evidence_accounts: existingEvidenceAccounts,
    ran_at: now.toISOString(),
  };
}
