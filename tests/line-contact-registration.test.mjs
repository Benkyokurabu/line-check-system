import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildLineContactAlias,
  lineContactDisplayNames,
  classifyLineContact,
  helperOriginAllowed,
  normalizeVerificationTargets,
  relationLabel,
  studentInstructionTypeLabel,
  studentEnrollmentLabel,
  studentRegistrationLabel,
  studentRegistrationSearchText,
} from "../src/lib/line-contact-registration.mjs";

test("graduation status and current individual tuition remain distinct in registration", () => {
  const former = { student_name: "試験卒塾生", grade: "高2", enrollment_status: "卒塾", instruction_type: "個別ほか" };
  assert.match(studentRegistrationLabel(former), /^卒塾｜高2｜試験卒塾生｜個別ほか/);
  assert.match(studentRegistrationSearchText(former), /卒塾/);
  assert.equal(studentEnrollmentLabel("current_roster"), "在塾");
  assert.match(studentRegistrationLabel({ ...former, enrollment_status: "current_roster" }), /^在塾｜/);
});

test("buildLineContactAlias makes campus/student/relation label", () => {
  assert.equal(buildLineContactAlias({ student_name: "山田 太郎", campus: "本校" }, "mother"), "本　山田太郎　母");
  assert.equal(buildLineContactAlias({ student_name: "佐藤花子", campus: "南教室" }, "student"), "南　佐藤花子");
});

test("saved contact name replaces stale link names without altering sibling links", () => {
  const accounts = [
    { student_number: "first", alias_name: "旧登録名", verification_status: "confirmed" },
    { student_number: "sibling", alias_name: "兄弟の登録名", verification_status: "confirmed" },
    { student_number: "wrong", alias_name: "未確認の別人", verification_status: "unverified" },
  ];
  const before = structuredClone(accounts);
  assert.deepEqual(lineContactDisplayNames([{ alias_name: "家族の共通名" }], accounts), ["家族の共通名"]);
  assert.deepEqual(accounts, before);
});

test("the reported mixture of confirmed and unverified names shows the saved name only", () => {
  assert.deepEqual(lineContactDisplayNames([{ alias_name: "南　試験一郎" }], [
    { alias_name: "南　試験一郎", verification_status: "confirmed" },
    { alias_name: "本　別の一郎", verification_status: "unverified" },
  ]), ["南　試験一郎"]);
});

test("contacts without saved names retain confirmed sibling names and legacy fallbacks", () => {
  assert.deepEqual(lineContactDisplayNames([{ alias_name: "  " }], [
    { alias_name: "本　試験一郎　母", verification_status: "confirmed" },
    { alias_name: "本　試験二郎　母", verification_status: "confirmed" },
    { alias_name: "別人", verification_status: "unverified" },
  ]), ["本　試験一郎　母", "本　試験二郎　母"]);
  assert.deepEqual(lineContactDisplayNames([], [
    { alias_name: "  旧名簿の名前  ", verification_status: "unverified" },
    { alias_name: "旧名簿の名前", verification_status: null },
    { alias_name: null },
  ]), ["旧名簿の名前"]);
  assert.deepEqual(lineContactDisplayNames([], []), []);
});

test("student registration labels show grade, instruction type and identifying details", () => {
  const student = {
    student_number: "2026123",
    student_name: "山田 太郎",
    grade: "高3",
    instruction_type: "個別ほか",
    campus: "本校",
    school_name: "県立高校",
    homeroom_teacher: "吉川",
  };
  assert.equal(studentInstructionTypeLabel(student.instruction_type), "個別ほか");
  assert.equal(studentRegistrationLabel(student), "高3｜山田 太郎｜個別ほか｜本校｜県立高校｜生徒番号 2026123");
  assert.match(studentRegistrationSearchText(student), /高3個別ほか本校県立高校吉川/);
});

test("student registration labels make missing instruction type explicit", () => {
  assert.equal(studentInstructionTypeLabel(null), "授業形態未設定");
  assert.match(studentRegistrationLabel({ student_name: "佐藤花子", grade: "高1" }), /授業形態未設定/);
});

test("normalizeVerificationTargets rejects empty and duplicate students", () => {
  assert.throws(() => normalizeVerificationTargets([]), /1名以上/);
  assert.throws(() => normalizeVerificationTargets([
    { student_number: "1", relation: "mother", alias_name: "A" },
    { student_number: "1", relation: "mother", alias_name: "B" },
  ]), /重複/);
});

test("normalizeVerificationTargets normalizes relation and primary", () => {
  assert.deepEqual(normalizeVerificationTargets([
    { student_number: " 10 ", relation: "student", alias_name: " 本　山田 " },
    { student_number: "11", relation: "unexpected", alias_name: "本　佐藤　保護者" },
  ]), [
    { student_number: "10", relation: "student", alias_name: "本　山田", is_primary: true },
    { student_number: "11", relation: "guardian", alias_name: "本　佐藤　保護者", is_primary: false },
  ]);
});

test("classifyLineContact prioritizes confirmed registrations", () => {
  assert.equal(classifyLineContact({ system_verified: true, pending_evidence: true }), "system_registered");
  assert.equal(classifyLineContact({ pending_evidence: true }), "pending");
  assert.equal(classifyLineContact({ alias_name: "imported" }), "other");
  assert.equal(relationLabel("father"), "父");
});

test("helper origin allowlist accepts production and local development only", () => {
  assert.equal(helperOriginAllowed("https://line-check-system.vercel.app"), true);
  assert.equal(helperOriginAllowed("https://line-check-system-abc123.vercel.app"), true);
  assert.equal(helperOriginAllowed("http://localhost:3000"), true);
  assert.equal(helperOriginAllowed("https://evil.example"), false);
});

test("contact summary API paginates beyond the Supabase 1000 row limit", async () => {
  const route = await readFile(new URL("../src/app/api/admin/contacts/route.ts", import.meta.url), "utf8");
  assert.match(route, /for \(let from = 0; ; from \+= 1000\)/);
  assert.match(route, /\.range\(from, from \+ 999\)/);
});

test("contacts screen includes all existing attendance LINE-link candidates in the review tab", async () => {
  const page = await readFile(new URL("../src/app/contacts/page.tsx", import.meta.url), "utf8");
  assert.match(page, /fetch\("\/api\/attendance\/line-link-candidates"\)/);
  assert.match(page, /candidateIds\.has\(contact\.line_user_id\)/);
  assert.match(page, /registration_state: "pending" as const/);
});

test("student LINE name edit only updates a confirmed student account through the audited RPC", async () => {
  const route = await readFile(new URL("../src/app/api/students/[studentNumber]/line-name/route.ts", import.meta.url), "utf8");
  assert.match(route, /\.eq\("relation", "student"\)/);
  assert.match(route, /\.eq\("verification_status", "confirmed"\)/);
  assert.match(route, /\.rpc\("verify_line_contact"/);
  assert.match(route, /p_source: "students_name_edit"/);
  assert.match(route, /p_verified_by: performedBy/);
});

test("attendance candidates expose only confirmed account relations for the name-edit decision", async () => {
  const route = await readFile(new URL("../src/app/api/attendance/candidates/route.ts", import.meta.url), "utf8");
  assert.match(route, /is_primary,verification_status/);
  assert.match(route, /account\.verification_status === "confirmed"/);
  assert.match(route, /student_accounts:/);
  assert.match(route, /alias_names: lineContactDisplayNames\(lineAliases, input\.accounts\)/);
});
