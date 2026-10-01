import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const file = "中２ クラス一覧表.xlsx";
const oldManifest = [{ file, size: 1, mtime_ms: 1 }];
const newManifest = [{ file, size: 2, mtime_ms: 2 }];
const student = (number, name = `生徒${number}`) => ({ student_number: number, grade: "中2", student_name: name,
  homeroom_teacher: "工藤", campus: "本校", source_file: file });
const enrollment = (number, name, classroom = "本") => ({ student_number: number, grade: "中2", subject: "数学",
  class_name: name, classroom, source_file: file });

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table student_roster(student_number text primary key,grade text not null,student_name text not null,
      homeroom_teacher text not null,campus text,school_name text,gender text,instruction_type text,source_file text,
      updated_at timestamptz not null default now());
    create table student_class_enrollments(id uuid primary key default gen_random_uuid(),student_number text not null references student_roster(student_number),
      grade text not null,subject text not null,class_name text not null,classroom text,source_file text,updated_at timestamptz default now(),
      unique(student_number,subject,class_name));
    create table app_settings(key text primary key,value jsonb not null,description text,updated_at timestamptz default now());`);
  await db.exec(await readFile(new URL("../supabase/roster_atomic_import_20261001.sql", import.meta.url), "utf8"));
  return db;
}

const apply = (db, roster, enrollments, manifest = newManifest, expected = oldManifest) => db.query(
  "select import_roster_from_excel_atomic($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) result",
  [JSON.stringify(roster), JSON.stringify(enrollments), JSON.stringify(manifest), expected == null ? null : JSON.stringify(expected)],
);

test("クラス一覧の更新は一括で確定し、別経路のX所属を保持する", async () => {
  const db = await database();
  try {
    await db.query("insert into student_roster(student_number,grade,student_name,homeroom_teacher,source_file) values('1','中2','旧名','工藤',$1),('2','中2','生徒2','工藤',$1)",[file]);
    await db.query("insert into student_class_enrollments(student_number,grade,subject,class_name,source_file) values('1','中2','数学','A',$1),('2','中2','数学','B',$1),('1','中2','英語','X','手動登録')",[file]);
    await db.query("insert into app_settings(key,value) values('roster_excel_import_manifest',$1)",[JSON.stringify(oldManifest)]);
    const result = await apply(db,[student("1","新名"),student("2")],[enrollment("1","A","南"),enrollment("2","C")]);
    assert.equal(result.rows[0].result.class_enrollments,2);
    assert.deepEqual((await db.query("select student_number,subject,class_name,coalesce(classroom,'') classroom from student_class_enrollments order by student_number,subject,class_name")).rows,
      [{student_number:"1",subject:"数学",class_name:"A",classroom:"南"},
        {student_number:"1",subject:"英語",class_name:"X",classroom:""},
        {student_number:"2",subject:"数学",class_name:"C",classroom:"本"}]);
    assert.equal((await db.query("select student_name from student_roster where student_number='1'")).rows[0].student_name,"新名");
    assert.deepEqual((await db.query("select value from app_settings where key='roster_excel_import_manifest'")).rows[0].value,newManifest);
  } finally { await db.close(); }
});

test("所属追加で失敗したら生徒・旧所属・取込履歴をすべて残す", async () => {
  const db = await database();
  try {
    await db.query("insert into student_roster(student_number,grade,student_name,homeroom_teacher,source_file) values('1','中2','旧名','工藤',$1)",[file]);
    await db.query("insert into student_class_enrollments(student_number,grade,subject,class_name,source_file) values('1','中2','数学','A',$1)",[file]);
    await db.query("insert into app_settings(key,value) values('roster_excel_import_manifest',$1)",[JSON.stringify(oldManifest)]);
    await assert.rejects(() => apply(db,[student("1","新名")],[enrollment("9","B")]),/foreign key/);
    assert.equal((await db.query("select student_name from student_roster where student_number='1'")).rows[0].student_name,"旧名");
    assert.equal((await db.query("select class_name from student_class_enrollments where student_number='1'")).rows[0].class_name,"A");
    assert.deepEqual((await db.query("select value from app_settings where key='roster_excel_import_manifest'")).rows[0].value,oldManifest);
    await assert.rejects(() => apply(db,[student("1")],[enrollment("1","A")],newManifest,[]),/roster_manifest_changed/);
  } finally { await db.close(); }
});

test("所属の大幅減少と匿名実行を拒否する", async () => {
  const db = await database();
  try {
    await db.exec(`insert into student_roster(student_number,grade,student_name,homeroom_teacher,source_file)
      select n::text,'中2','生徒','工藤','中２ クラス一覧表.xlsx' from generate_series(1,20) n;
      insert into student_class_enrollments(student_number,grade,subject,class_name,source_file)
      select n::text,'中2','数学','A','中２ クラス一覧表.xlsx' from generate_series(1,20) n;`);
    await assert.rejects(() => apply(db,[student("1")],[enrollment("1","A")],newManifest,null),/roster_import_large_decrease/);
    assert.equal((await db.query("select count(*)::int count from student_class_enrollments")).rows[0].count,20);
    await db.exec("set role anon");
    await assert.rejects(() => apply(db,[student("1")],[enrollment("1","A")],newManifest,null),/permission denied/);
    await db.exec("reset role");
  } finally { await db.close(); }
});
