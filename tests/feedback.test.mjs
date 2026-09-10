import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { validateFeedback } from "../src/lib/feedback-core.mjs";

const db = new PGlite();
const owner = randomUUID(), other = randomUUID(), session = randomUUID();
before(async () => {
  // Authentication boundary fixture; managed identity/session validation is covered
  // by staff-auth-core.test.mjs and staff-auth-db.test.mjs.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.staff_accounts(id uuid primary key, active boolean default true);
    create function public.staff_authorize(p_user uuid,p_session uuid) returns jsonb language plpgsql as $$
    begin
      if p_session <> '${session}'::uuid or not exists(select 1 from staff_accounts where id=p_user and active) then raise exception 'staff_session_invalid'; end if;
      return jsonb_build_object('staffId',p_user);
    end; $$;`);
  await db.query("insert into staff_accounts(id) values($1),($2)", [owner, other]);
  await db.exec(await readFile(new URL("../supabase/feedback_20260910.sql", import.meta.url), "utf8"));
  await db.query("insert into bentan_feedback_reader(staff_id) values($1)", [owner]);
});
after(() => db.close());

test("feedback validates bounded nonempty names, bodies and operation IDs", () => {
  assert.deepEqual(validateFeedback({ id: owner, name: " 名前 ", message: " 改善案 " }), { id: owner, name: "名前", message: "改善案" });
  for (const patch of [{ id: "bad" }, { name: " " }, { message: " " }, { name: "x".repeat(101) }, { message: "x".repeat(2001) }]) {
    assert.throws(() => validateFeedback({ id: owner, name: "name", message: "text", ...patch }));
  }
});
test("feedback retries create one entry, conflicts do not overwrite", async () => {
  const id = randomUUID();
  for (let i = 0; i < 2; i++) await db.query("select submit_bentan_feedback($1,'名前','<script>本文</script>',$2)", [id, "a".repeat(64)]);
  assert.equal((await db.query("select count(*)::int count from bentan_feedback where id=$1", [id])).rows[0].count, 1);
  await assert.rejects(db.query("select submit_bentan_feedback($1,'別名','上書き',$2)", [id, "a".repeat(64)]), /feedback_conflict/);
});
test("only configured owner can list; other staff and invalid sessions are denied", async () => {
  const result = (await db.query("select list_bentan_feedback($1,$2) result", [owner, session])).rows[0].result;
  assert.equal(result.feedback.length, 1);
  assert.equal(result.feedback[0].rate_key, undefined);
  await assert.rejects(db.query("select list_bentan_feedback($1,$2)", [other, session]), /staff_permission_denied/);
  await assert.rejects(db.query("select list_bentan_feedback($1,$2)", [owner, randomUUID()]), /staff_session_invalid/);
  await db.query("update staff_accounts set active=false where id=$1", [owner]);
  await assert.rejects(db.query("select list_bentan_feedback($1,$2)", [owner, session]), /staff_session_invalid/);
  await db.query("update staff_accounts set active=true where id=$1", [owner]);
});
test("anonymous and authenticated clients cannot read tables or execute inbox RPC", async () => {
  for (const role of ["anon", "authenticated"]) {
    const result = (await db.query(`select has_table_privilege('${role}','bentan_feedback','select') table_read,
      has_function_privilege('${role}','list_bentan_feedback(uuid,uuid,integer)','execute') rpc_read,
      has_function_privilege('${role}','submit_bentan_feedback(uuid,text,text,text)','execute') rpc_write`)).rows[0];
    assert.deepEqual(result, { table_read: false, rpc_read: false, rpc_write: false });
  }
});
test("feedback submission rate is bounded and a retry still succeeds at the limit", async () => {
  const ids = Array.from({ length: 10 }, randomUUID);
  for (const id of ids) await db.query("select submit_bentan_feedback($1,'名前','本文',$2)", [id, "b".repeat(64)]);
  await assert.rejects(db.query("select submit_bentan_feedback($1,'名前','本文',$2)", [randomUUID(), "b".repeat(64)]), /feedback_rate_limit/);
  assert.equal((await db.query("select submit_bentan_feedback($1,'名前','本文',$2) result", [ids[0], "b".repeat(64)])).rows[0].result.accepted, true);
});
