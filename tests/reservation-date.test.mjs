import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getJapanDate, getReservationRequestKind, isValidReservationDate } from "../src/lib/reservation-date.mjs";

test("Japanese midnight changes the date before UTC midnight", () => {
  assert.equal(getJapanDate(new Date("2026-09-04T14:59:59.999Z")), "2026-09-04");
  assert.equal(getJapanDate(new Date("2026-09-04T15:00:00.000Z")), "2026-09-05");
  assert.equal(getJapanDate(new Date("2026-09-05T08:59:00+09:00")), "2026-09-05");
});

test("prior-day 23:59 remains advance; 00:00 becomes same-day", () => {
  assert.equal(getReservationRequestKind("2026-09-05", new Date("2026-09-04T23:59:59.999+09:00")), "advance");
  assert.equal(getReservationRequestKind("2026-09-05", new Date("2026-09-05T00:00:00+09:00")), "same_day");
  assert.equal(getReservationRequestKind("2026-09-05", new Date("2026-09-05T23:59:59.999+09:00")), "same_day");
  assert.equal(getReservationRequestKind("2026-09-05", new Date("2026-09-06T00:00:00+09:00")), "past");
});

test("year boundaries and leap dates use the same calendar rules", () => {
  assert.equal(getJapanDate(new Date("2026-12-31T15:00:00Z")), "2027-01-01");
  assert.equal(getReservationRequestKind("2026-12-31", new Date("2026-12-31T15:00:00Z")), "past");
  assert.equal(getJapanDate(new Date("2028-02-28T15:00:00Z")), "2028-02-29");
  for (const value of ["2028-02-29", "2000-02-29", "2026-04-30", "0001-01-01", "9999-12-31"]) {
    assert.equal(isValidReservationDate(value), true, value);
  }
});

test("invalid calendar dates do not silently roll into the following month", () => {
  for (const value of ["2026-02-29", "2100-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "2026-01-32", "0000-01-01", "2026-9-05", " 2026-09-05", "2026-09-05T00:00:00Z", "", null, undefined, 20260905]) {
    assert.equal(isValidReservationDate(value), false, String(value));
  }
  assert.throws(() => getReservationRequestKind("2026-02-29"), RangeError);
  assert.throws(() => getJapanDate(new Date(NaN)), RangeError);
});

test("request classification depends on the instant, not the caller's offset", () => {
  const instants = ["2026-09-04T15:00:00Z", "2026-09-05T00:00:00+09:00", "2026-09-04T08:00:00-07:00"];
  for (const instant of instants) {
    assert.equal(getReservationRequestKind("2026-09-05", new Date(instant)), "same_day");
  }
});

test("both reservation screens and the server use the shared Japanese date policy", async () => {
  for (const path of ["../src/app/self-study-room/page.tsx", "../src/app/admin/self-study-room/page.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /getJapanDate/);
    assert.doesNotMatch(source, /toISOString\(\)\.slice\(0, 10\)/);
  }
  const route = await readFile(new URL("../src/app/api/self-study-room/route.ts", import.meta.url), "utf8");
  assert.match(route, /getReservationRequestKind\(date\) === "past"/);
  const library = await readFile(new URL("../src/lib/self-study-room.ts", import.meta.url), "utf8");
  assert.match(library, /isValidReservationDate as isValidDate/);
});
