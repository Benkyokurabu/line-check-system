const RESERVATION_RELATIONS = new Set(["student", "mother", "father", "guardian"]);

/**
 * Domain check only, not LINE authentication. The caller must obtain actorLineUserId
 * from a server-verified LINE identity and accounts from the authoritative database,
 * never from request JSON. Recheck on every mutation so revocation takes effect.
 * No names, other linked children, or LINE IDs are returned by this decision.
 *
 * @param {{actorLineUserId: unknown, targetStudentNumber: unknown, accounts: unknown}} input
 */
export function authorizeReservationSubject({ actorLineUserId, targetStudentNumber, accounts }) {
  if (typeof actorLineUserId !== "string" || !actorLineUserId.trim()) {
    return { allowed: false, reason: "identity_required" };
  }
  if (typeof targetStudentNumber !== "string" || !targetStudentNumber.trim()) {
    return { allowed: false, reason: "subject_required" };
  }
  if (!Array.isArray(accounts)) return { allowed: false, reason: "verification_unavailable" };

  const actor = actorLineUserId.trim();
  const subject = targetStudentNumber.trim();
  const matches = accounts.filter((row) => row && typeof row === "object"
    && row.line_user_id === actor && row.student_number === subject);

  if (!matches.length) return { allowed: false, reason: "not_linked" };
  // The database has a unique actor/subject pair. A duplicate result is an integrity
  // problem, not a reason to select whichever row grants the most permission.
  if (matches.length !== 1) return { allowed: false, reason: "needs_review" };
  const account = matches[0];
  if (account.verification_status === "revoked") return { allowed: false, reason: "revoked" };
  if (account.verification_status !== "confirmed") return { allowed: false, reason: "needs_review" };
  if (!RESERVATION_RELATIONS.has(account.relation)) return { allowed: false, reason: "needs_review" };

  return {
    allowed: true,
    reason: "confirmed_link",
    actingAs: account.relation === "student" ? "self" : "guardian",
  };
}
