import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseScheduleWorkbook } from "../src/lib/schedule-excel.mjs";
const fixture = fs.readFileSync(new URL("./fixtures/schedule-synthetic.xlsx", import.meta.url));
test("Excel uses indexed/RGB/theme legend colours, grade-specific time bands and actual room headers", () => {
  const rows = parseScheduleWorkbook(fixture, "2026-09");
  assert.equal(rows.length, 3);
  const english = rows.find((r) => r.subject === "eng");
  assert.equal(english.teacher, "テスト甲"); assert.equal(english.time, "6:35～8:05"); assert.equal(english.room, "1");
  const arithmetic = rows.find((r) => r.subject === "arith");
  assert.equal(arithmetic.teacher, "テスト乙"); assert.equal(arithmetic.time, "4:55～6:15"); assert.equal(arithmetic.displayTitle, "5A算対面");
  const special = rows.find((r) => r.isSpecialLesson);
  assert.equal(special.room, "3"); assert.equal(special.teacher, "テスト丙");
});
test("invalid and oversized Excel fails closed", () => {
  assert.throws(() => parseScheduleWorkbook(Buffer.from("not a workbook"), "2026-09"));
  assert.throws(() => parseScheduleWorkbook(Buffer.alloc(9 * 1024 * 1024), "2026-09"));
});
