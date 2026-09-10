import assert from "node:assert/strict";
import test from "node:test";
import { attendanceRangeDates } from "../src/lib/attendance-date-range.mjs";
test("attendance period includes both endpoints across month/year/leap boundaries", () => {
  assert.deepEqual(attendanceRangeDates("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.deepEqual(attendanceRangeDates("2026-12-31", "2027-01-01"), ["2026-12-31", "2027-01-01"]);
  assert.deepEqual(attendanceRangeDates("2026-09-10", "2026-09-10"), ["2026-09-10"]);
});
test("invalid dates, reversed and excessive periods are rejected", () => {
  for (const dates of [["2026-02-29", "2026-03-01"], ["", "2026-09-10"], ["2026-09-11", "2026-09-10"], ["2026-01-01", "2026-12-31"]]) assert.throws(() => attendanceRangeDates(...dates));
  assert.equal(attendanceRangeDates("2026-01-01", "2026-04-03").length, 93);
});
