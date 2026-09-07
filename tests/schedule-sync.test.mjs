import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { buildSchedulePreview } from "../src/lib/schedule-preview.mjs";
import { authorizeScheduleSync, scheduleSyncToken, scheduleSyncMonths, scheduleSyncBlockers, syncSchedule } from "../src/lib/schedule-sync.mjs";

test("JST rollover and dedicated worker authentication", () => {
  assert.deepEqual(scheduleSyncMonths(new Date("2026-12-31T15:00:00Z")), ["2027-01", "2027-02"]);
  const key = "server-test-key";
  assert.equal(authorizeScheduleSync(new Request("https://test", { headers: { authorization: `Bearer ${scheduleSyncToken(key)}` } }), key), true);
  assert.equal(authorizeScheduleSync(new Request("https://test", { headers: { authorization: "Bearer wrong" } }), key), false);
});
test("missing sources, unsafe diffs and upload settling never mutate lessons", async () => {
  for (const scenario of ["missing", "remove", "ambiguous", "recent", "error"]) {
    const calls = [];
    const db = { async rpc(name, args) { calls.push({ name, args }); return { data: name === "schedule_sync_claim" ? "run" : null }; } };
    const options = { now: new Date("2026-09-07T10:00:00Z"), listMonths: async () => scenario === "missing" ? [] : [{ month: "2026-09" }],
      preview: async () => { if (scenario === "error") throw new Error("private credential detail"); return { summary: { [scenario]: 1 }, changes: [], source: { modifiedAt: scenario === "recent" ? "2026-09-07T10:00:00Z" : "2026-09-01T00:00:00Z" } }; } };
    if (scenario === "error") await assert.rejects(syncSchedule(db, "2026-09", "key", options), (e) => !e.message.includes("private"));
    else await syncSchedule(db, "2026-09", "key", options);
    assert.ok(!calls.some((c) => c.name === "schedule_sync_apply"));
    assert.equal(calls.at(-1).name, "schedule_sync_finish");
  }
  assert.equal(scheduleSyncBlockers({ summary: {}, changes: [{ before: { lesson_date: "2026-09-06" } }] }, new Date("2026-09-07T10:00:00Z")).length, 1);
});
test("atomic persistence keeps attendance links, rejects stale plans and restricts browser roles", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    const schema = fs.readFileSync(new URL("../supabase/attendance_schema.sql", import.meta.url), "utf8");
    await db.exec(schema.slice(0, schema.indexOf("create index")));
    await db.exec("create table attendance_link(id integer primary key,lesson_id uuid not null references lessons(id) on delete restrict)");
    await db.exec(fs.readFileSync(new URL("../supabase/schedule_sync.sql", import.meta.url), "utf8"));
    await db.exec("update schedule_sync_control set enabled=true");
    const month = scheduleSyncMonths()[1];
    const item = { date: `${month}-07`, time: "18:00～19:30", grade: "j1", class: "S", subject: "eng", campus: "hon", room: "1", groupKey: "hon_j1_S_eng", label: "中1S 英語", teacher: "講師" };
    const preview = (items, existing) => ({ ...buildSchedulePreview(items, existing, month), existing, source: { file: "source.xlsm", sha256: "test" } });
    const claim = async () => {
      await db.exec("update schedule_sync_control set last_started_at=null");
      return (await db.query("select schedule_sync_claim($1,'cron') id", [month])).rows[0].id;
    };
    const apply = (run, report) => db.query("select schedule_sync_apply($1,$2::jsonb) result", [run, JSON.stringify(report)]);
    const first = await claim();
    assert.equal((await db.query("select schedule_sync_claim($1,'manual') id", [month])).rows[0].id, null);
    await apply(first, preview([item], []));
    const old = (await db.query("select to_jsonb(l) as lesson from lessons l")).rows[0].lesson;
    await db.query("insert into attendance_link values(1,$1)", [old.id]);
    const second = await claim();
    const updated = { ...item, room: "2", time: "19:00～20:30" };
    await apply(second, preview([updated], [old]));
    const actual = (await db.query("select to_jsonb(l) as lesson from lessons l")).rows[0].lesson;
    assert.equal(actual.id, old.id); assert.equal(actual.classroom, "2"); assert.equal(actual.start_time, "19:00～20:30");
    assert.equal((await db.query("select lesson_id from attendance_link")).rows[0].lesson_id, old.id);
    assert.equal((await db.query("select snapshot from schedule_sync_runs where id=$1", [second])).rows[0].snapshot.existing[0].classroom, "1");
    const third = await claim();
    await assert.rejects(apply(third, preview([item], [old])), /snapshot changed/);
    assert.equal((await db.query("select classroom from lessons")).rows[0].classroom, "2");
    // A late invalid operation rolls back an earlier valid addition in the same transaction.
    const bad = preview([updated, { ...updated, date: `${month}-08` }], [actual]);
    bad.changes.push({ kind: "remove", before: actual });
    await assert.rejects(apply(third, bad), /review required/);
    assert.equal((await db.query("select count(*)::int n from lessons")).rows[0].n, 1);
    await db.query("select schedule_sync_finish($1,'error','test')", [third]);
    const fourth = await claim();
    assert.equal((await apply(fourth, preview([updated], [actual]))).rows[0].result.status, "unchanged");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from schedule_sync_runs"), /permission denied/);
      await assert.rejects(db.query("select schedule_sync_claim($1,'manual')", [month]), /permission denied/);
      await assert.rejects(apply(fourth, preview([updated], [actual])), /permission denied/);
      await db.exec("reset role");
    }
  } finally { await db.close(); }
});
