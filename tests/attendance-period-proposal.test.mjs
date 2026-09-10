import test from "node:test";
import assert from "node:assert/strict";
import { attendancePeriodProposal, lessonsForPeriodProposal } from "../src/lib/attendance-period-proposal.mjs";
const rows = () => [11, 12, 13].map((day) => ({ event_date: `2026-09-${day}`, event_type: "absence", status: "pending", student_number: "sample", ai_summary: "体調不良" }));
test("uniform consecutive dates form a proposal; edited, mixed or completed rows stay intact", () => {
  assert.deepEqual(attendancePeriodProposal(rows()), { start: "2026-09-11", end: "2026-09-13", eventType: "absence", reason: "体調不良", subject: "", className: "", arrival: "" });
  for (const patch of [{ status: "confirmed" }, { student_number: "sibling" }, { event_type: "late" }, { note_internal: "memo" }, { lesson_id: "chosen" }, { ai_summary: "別の理由" }]) {
    const items = rows(); Object.assign(items[1], patch); assert.equal(attendancePeriodProposal(items), null);
  }
  assert.equal(attendancePeriodProposal([rows()[0], rows()[2]]), null);
  assert.equal(attendancePeriodProposal([rows()[0], rows()[0]]), null);
});
test("proposal respects date boundaries and an explicit subject or class", () => {
  const proposal = { ...attendancePeriodProposal(rows()), subject: "数学", className: "Ａ" };
  const lessons = [{ id: 1, lesson_date: "2026-09-11", subject: "数学", class_name: "A" }, { id: 2, lesson_date: "2026-09-11", subject: "英語", class_name: "A" }, { id: 3, lesson_date: "2026-09-14", subject: "数学", class_name: "A" }];
  assert.deepEqual(lessonsForPeriodProposal(lessons, proposal).map((l) => l.id), [1]);
});
