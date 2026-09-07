import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sealScheduleConnection, openScheduleConnection, listScheduleCloudMonths, getScheduleCloudPreview } from "../src/lib/schedule-cloud.mjs";
const fixture = fs.readFileSync(new URL("./fixtures/schedule-synthetic.xlsx", import.meta.url));
const key = "test-server-secret-not-production-1234";
function setup(options = {}) {
  const config = { driveId: "drive", folderId: "folder", clientId: "client", clientSecret: "secret", token: { access_token: "access-test", refresh_token: "refresh-test", expiry: options.expired ? "2020-01-01" : "2099-01-01" } };
  const state = { encrypted: sealScheduleConnection(config, key), version: 1, updates: [], calls: [], metadataReads: 0 };
  const db = { from(table) {
    const builder = {
      select() { return builder; }, eq() { return builder; }, gte() { return builder; }, lt() { return builder; }, order() { return builder; }, in() { return builder; },
      async single() { return { data: { encrypted: state.encrypted, version: state.version } }; },
      async range() { return options.errorTable ? { error: { message: "database details" } } : { data: [] }; },
      update(value) { assert.equal(table, "schedule_cloud_connection"); state.updates.push(value); state.encrypted = value.encrypted; state.version = value.version; return builder; },
      then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
    }; return builder;
  } };
  const file = { id: "file", name: "2026年9月スケジュール.xlsm", eTag: "v1", file: {}, lastModifiedDateTime: "2026-09-01T00:00:00Z" };
  const fetcher = async (url, init = {}) => {
    const u = String(url); state.calls.push({ url: u, method: init.method ?? "GET", authorization: init.headers?.Authorization });
    if (u.includes("/oauth2/")) return Response.json({ access_token: "refreshed-access", refresh_token: "refreshed-refresh", expires_in: 3600 });
    if (u.includes("/children?")) return Response.json({ value: options.duplicate ? [file, { ...file, id: "other" }] : [file] });
    if (u.includes("/items/file")) {
      state.metadataReads++;
      return Response.json({ ...file, eTag: options.changed && state.metadataReads > 1 ? "v2" : "v1", "@microsoft.graph.downloadUrl": `https://${options.badHost ? "evil.invalid" : "my.microsoftpersonalcontent.com"}/download` });
    }
    if (u.endsWith("/download")) { assert.equal(init.headers, undefined); return new Response(fixture); }
    throw new Error("Unexpected request");
  };
  return { db, fetcher, state };
}
test("credentials are encrypted and wrong keys/tampering are rejected", () => {
  const sealed = sealScheduleConnection({ token: "sensitive" }, key);
  assert.ok(!sealed.includes("sensitive")); assert.deepEqual(openScheduleConnection(sealed, key), { token: "sensitive" });
  assert.throws(() => openScheduleConnection(sealed, key + "wrong"));
  const parts = sealed.split("."); parts[2] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => openScheduleConnection(parts.join("."), key));
});
test("cloud Excel returns only review data without credentials or Graph URLs", async () => {
  const { db, fetcher, state } = setup();
  assert.deepEqual((await listScheduleCloudMonths(db, key, fetcher)).map((m) => m.month), ["2026-09"]);
  const report = await getScheduleCloudPreview(db, "2026-09", key, fetcher);
  assert.equal(report.summary.incoming, 3); assert.equal(report.applied, false);
  assert.equal(state.updates.length, 0); assert.ok(state.calls.every((c) => c.method === "GET"));
  for (const sensitive of ["access-test", "refresh-test", "clientSecret", "graph.microsoft", "microsoftpersonalcontent", "folderId"]) assert.ok(!JSON.stringify(report).includes(sensitive));
});
test("expired credential is refreshed and saved encrypted", async () => {
  const { db, fetcher, state } = setup({ expired: true });
  await listScheduleCloudMonths(db, key, fetcher);
  assert.equal(state.updates.length, 1);
  assert.equal(openScheduleConnection(state.encrypted, key).token.refresh_token, "refreshed-refresh");
  assert.ok(!state.encrypted.includes("refreshed-refresh"));
});
test("duplicates, edits during reading, untrusted hosts and DB failures stop preview", async () => {
  for (const option of [{ duplicate: true }, { changed: true }, { badHost: true }, { errorTable: true }]) {
    const { db, fetcher } = setup(option);
    await assert.rejects(getScheduleCloudPreview(db, "2026-09", key, fetcher));
  }
});
test("missing month is clear and does not download another month", async () => {
  const { db, fetcher, state } = setup();
  await assert.rejects(getScheduleCloudPreview(db, "2026-10", key, fetcher), /フォルダにありません/);
  assert.equal(state.metadataReads, 0);
});
test("connection table cannot be read or changed by browser roles", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await db.exec(fs.readFileSync(new URL("../supabase/schedule_cloud_connection.sql", import.meta.url), "utf8"));
    await db.query("insert into schedule_cloud_connection(id, encrypted) values ('primary', 'test-ciphertext')");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from schedule_cloud_connection"), /permission denied/);
      await assert.rejects(db.query("update schedule_cloud_connection set encrypted='bad'"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.equal((await db.query("select version from schedule_cloud_connection")).rows[0].version, 1);
  } finally { await db.close(); }
});
