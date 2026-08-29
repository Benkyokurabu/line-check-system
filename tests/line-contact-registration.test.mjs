import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildLineContactAlias,
  classifyLineContact,
  helperOriginAllowed,
  normalizeVerificationTargets,
  relationLabel,
} from "../src/lib/line-contact-registration.mjs";

test("buildLineContactAlias makes campus/student/relation label", () => {
  assert.equal(buildLineContactAlias({ student_name: "山田 太郎", campus: "本校" }, "mother"), "本　山田太郎　母");
  assert.equal(buildLineContactAlias({ student_name: "佐藤花子", campus: "南教室" }, "student"), "南　佐藤花子");
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
