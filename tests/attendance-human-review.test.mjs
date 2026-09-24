import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("staff-selected student and lesson toggles persist with a per-message audit", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table attendance_candidates (
        id uuid primary key, student_number text, event_type text, event_date date,
        lesson_id uuid, ai_summary text, status text not null
      );
      create table attendance_candidate_items (
        id uuid primary key default gen_random_uuid(), candidate_id uuid not null,
        student_number text, event_type text, event_date date, lesson_id uuid,
        suggested_subject text, suggested_class_name text, ai_summary text,
        arrival_expected_time text, note_internal text, note_for_classroom text,
        cross_campus_override boolean, cross_campus_reason text, status text not null
      );
    `);
    const schema = await readFile(new URL("../supabase/attendance_schema.sql", import.meta.url), "utf8");
    const draftFunction = schema.match(/create or replace function public\.replace_attendance_candidate_draft\([\s\S]*?\$\$;/)?.[0];
    assert.ok(draftFunction);
    await db.exec(draftFunction);
    await db.exec(await readFile(new URL("../supabase/attendance_human_review_20260924.sql", import.meta.url), "utf8"));
    const candidateId = "11111111-1111-4111-8111-111111111111";
    const lessonId = "22222222-2222-4222-8222-222222222222";
    await db.query("insert into attendance_candidates(id,student_number,event_type,event_date,status) values($1,'old','absence','2026-09-24','pending')", [candidateId]);
    await db.query("insert into attendance_candidate_items(candidate_id,student_number,event_type,event_date,lesson_id,status) values($1,'old','absence','2026-09-24',null,'pending')", [candidateId]);
    const save = async (student, lesson, actor) => db.query(
      "select public.save_attendance_candidate_review($1,$2::jsonb,$3::jsonb,$4)",
      [candidateId, JSON.stringify({ student_number: student, event_type: "absence", event_date: "2026-09-24", lesson_id: lesson }), JSON.stringify([{ student_number: student, event_type: "absence", event_date: "2026-09-24", lesson_id: lesson }]), actor],
    );
    await save("new", lessonId, "担当A");
    let result = await db.query("select student_number,human_reviewed_at,human_reviewed_by from attendance_candidates where id=$1", [candidateId]);
    assert.equal(result.rows[0].student_number, "new");
    assert.ok(result.rows[0].human_reviewed_at);
    assert.equal(result.rows[0].human_reviewed_by, "担当A");
    await save("new", null, "担当B");
    result = await db.query("select lesson_id from attendance_candidate_items where candidate_id=$1", [candidateId]);
    assert.equal(result.rows[0].lesson_id, null);
    result = await db.query("select actor,before_student_number,after_student_number,before_lessons,after_lessons from attendance_candidate_review_audit where candidate_id=$1 order by id", [candidateId]);
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows.map((row) => row.actor), ["担当A", "担当B"]);
    assert.equal(result.rows[0].after_student_number, "new");
    assert.equal(result.rows[1].before_lessons[0].lesson_id, lessonId);
    assert.equal(result.rows[1].after_lessons[0].lesson_id, null);
  } finally {
    await db.close();
  }
});
