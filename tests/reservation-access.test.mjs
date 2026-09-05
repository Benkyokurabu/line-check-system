import assert from "node:assert/strict";
import test from "node:test";
import { authorizeReservationSubject } from "../src/lib/reservation-access.mjs";

const account = (overrides = {}) => ({
  line_user_id: "verified-line-actor",
  student_number: "test-student-1",
  relation: "student",
  verification_status: "confirmed",
  ...overrides,
});
const decide = (accounts, overrides = {}) => authorizeReservationSubject({
  actorLineUserId: "verified-line-actor", targetStudentNumber: "test-student-1", accounts, ...overrides,
});

test("a confirmed student acts only for their linked student record", () => {
  assert.deepEqual(decide([account()]), { allowed: true, reason: "confirmed_link", actingAs: "self" });
  assert.equal(decide([account()], { targetStudentNumber: "test-student-2" }).allowed, false);
});

test("a confirmed mother, father or guardian can apply without a student LINE account", () => {
  for (const relation of ["mother", "father", "guardian"]) {
    assert.deepEqual(decide([account({ relation })]), { allowed: true, reason: "confirmed_link", actingAs: "guardian" });
  }
});

test("each sibling needs a separate confirmed link", () => {
  const accounts = [account({ relation: "mother" }), account({ relation: "mother", student_number: "test-student-2" })];
  assert.equal(decide(accounts).allowed, true);
  assert.equal(decide(accounts, { targetStudentNumber: "test-student-2" }).allowed, true);
  assert.equal(decide(accounts, { targetStudentNumber: "test-student-3" }).allowed, false);
});

test("a matching name, primary flag, or inferred link does not grant reservation access", () => {
  for (const verification_status of [undefined, "unverified", "needs_review", "other"]) {
    assert.deepEqual(decide([account({ verification_status, is_primary: true, source: "line_display_surname_and_message_given_name" })]), { allowed: false, reason: "needs_review" });
  }
});

test("unknown or family relationship needs explicit guardian confirmation", () => {
  for (const relation of ["family", "unknown", "teacher", undefined]) {
    assert.deepEqual(decide([account({ relation })]), { allowed: false, reason: "needs_review" });
  }
});

test("revoked access is denied on the next decision", () => {
  assert.equal(decide([account()]).allowed, true);
  assert.deepEqual(decide([account({ verification_status: "revoked" })]), { allowed: false, reason: "revoked" });
});

test("links belonging to another LINE actor do not authorize this actor", () => {
  assert.deepEqual(decide([account({ line_user_id: "different-line-actor" })]), { allowed: false, reason: "not_linked" });
});

test("ambiguous duplicate rows are denied rather than selecting a permissive row", () => {
  assert.deepEqual(decide([account(), account({ verification_status: "revoked" })]), { allowed: false, reason: "needs_review" });
  assert.deepEqual(decide([account(), account()]), { allowed: false, reason: "needs_review" });
});

test("missing identity, subject and lookup result fail closed without exposing contact data", () => {
  assert.deepEqual(decide([account()], { actorLineUserId: "" }), { allowed: false, reason: "identity_required" });
  assert.deepEqual(decide([account()], { targetStudentNumber: " " }), { allowed: false, reason: "subject_required" });
  for (const accounts of [null, undefined, {}]) {
    assert.deepEqual(decide(accounts), { allowed: false, reason: "verification_unavailable" });
  }
  assert.deepEqual(decide([null, false, {}, account({ student_number: "other-child" })]), { allowed: false, reason: "not_linked" });
});
