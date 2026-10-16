import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("表示名の保存と履歴が同時に確定し、既存登録・混在履歴・権限を保護する", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table line_user_aliases(line_user_id text primary key,alias_name text,group_name text,updated_at timestamptz default now());
      create table student_roster(student_number text primary key,student_name text);
      create table line_contact_registration_events(id uuid primary key default gen_random_uuid(),line_user_id text,student_number text,action text,relation text,alias_name text,performed_by text,source text,previous_value jsonb,created_at timestamptz default now());
      create table line_messages(id uuid primary key,line_user_id text,text text);
      create table attendance_candidates(id uuid primary key,source_message_id uuid);
      create table attendance_candidate_review_audit(id bigint generated always as identity,candidate_id uuid,actor text,before_student_number text,after_student_number text,before_lessons jsonb,after_lessons jsonb,created_at timestamptz default now());
      insert into line_user_aliases values('line-1','旧名','保護者',now());
      insert into student_roster values('1','架空 一郎'),('2','架空 二郎');`);
    const sql = await readFile(new URL("../supabase/line_change_history_20261016.sql", import.meta.url), "utf8");
    await db.exec(sql); await db.exec(sql);
    const update = (alias, hasAlias = true, group = null, hasGroup = false, del = false) => db.query("select update_line_contact_alias('line-1',$1,$2,$3,$4,'確認先生',$5)", [alias, hasAlias, group, hasGroup, del]);
    await update("新名");
    assert.deepEqual((await db.query("select alias_name,group_name from line_user_aliases")).rows, [{ alias_name: "新名", group_name: "保護者" }]);
    await update("新名");
    assert.equal((await db.query("select * from line_contact_registration_events")).rows.length, 1);
    await update(null, false, "スタッフ", true);
    assert.equal((await db.query("select alias_name from line_user_aliases")).rows[0].alias_name, "新名");
    const cid = "11111111-1111-4111-8111-111111111111", mid = "22222222-2222-4222-8222-222222222222", other = "33333333-3333-4333-8333-333333333333";
    await db.query("insert into line_messages values($1,'line-1','二郎が欠席します')", [mid]);
    await db.query("insert into attendance_candidates values($1,$2),($3,$2)", [cid, mid, other]);
    await db.query("insert into attendance_candidate_review_audit(candidate_id,actor,before_student_number,after_student_number,before_lessons,after_lessons) values($1,'受付先生','1','2','[]','[{\"lesson_id\":\"lesson\"}]'),($2,'別の先生','1','2','[]','[]')", [cid, other]);
    await db.exec("insert into line_contact_registration_events(line_user_id,student_number,action,relation,alias_name,performed_by,source) values('line-1','1','confirmed','mother','保護者名','確認先生','contacts_review'),('other-line','2','updated','student','別のLINE','他の先生','students_name_edit')");
    const history = async candidate => (await db.query("select get_line_change_history('line-1',$1) history", [candidate])).rows[0].history;
    const timeline = await history(cid);
    assert.equal(timeline.length, 4);
    assert.deepEqual(new Set(timeline.map(event => event.kind)), new Set(["name", "group", "registration", "attendance"]));
    const name = timeline.find(event => event.kind === "name");
    assert.equal(name.before_value.alias_name, "旧名"); assert.equal(name.after_value.alias_name, "新名"); assert.equal(name.actor, "確認先生");
    const attendance = timeline.find(event => event.kind === "attendance");
    assert.equal(attendance.before_value.student_name, "架空 一郎"); assert.equal(attendance.after_value.student_name, "架空 二郎");
    assert.equal(attendance.after_value.lessons.length, 1);
    assert.equal((await history(null)).length, 5);
    await db.exec("create function reject_test_audit() returns trigger language plpgsql as $$begin raise exception 'test audit failed';end$$;create trigger fail_audit before insert on line_contact_registration_events for each row execute function reject_test_audit()");
    await assert.rejects(() => update("失敗する名前"), /test audit failed/);
    assert.equal((await db.query("select alias_name from line_user_aliases")).rows[0].alias_name, "新名");
    await db.exec("drop trigger fail_audit on line_contact_registration_events");
    await update(null, false, null, false, true);
    assert.equal((await db.query("select * from line_user_aliases")).rows.length, 0);
    assert.ok((await history(null)).some(event => event.kind === "name" && event.after_value.alias_name === null));
    for (const role of ["anon", "authenticated"]) {
      const privileges = (await db.query(`select has_function_privilege('${role}','update_line_contact_alias(text,text,boolean,text,boolean,text,boolean)','execute') write,has_function_privilege('${role}','get_line_change_history(text,uuid)','execute') read`)).rows[0];
      assert.deepEqual(privileges, { write: false, read: false });
    }
  } finally { await db.close(); }
});
