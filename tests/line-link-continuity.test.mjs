import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const sql=fs.readFileSync(new URL('../supabase/line_link_continuity_20261019.sql',import.meta.url),'utf8');
test('既存の全紐付けを引継ぎ、確認済み・取消済みを保持し、今後の登録も欠落させない',async()=>{
 const db=new PGlite();const a='U'+'1'.repeat(32),b='U'+'2'.repeat(32),c='U'+'3'.repeat(32);
 try{
  await db.exec(`create table student_registry(student_number text primary key);create table line_user_aliases(line_user_id text primary key,alias_name text);create table student_line_links(student_number text,line_user_id text,unique(student_number,line_user_id));create table student_line_accounts(student_number text,line_user_id text,relation text,alias_name text,is_primary boolean,source text,verification_status text,unique(student_number,line_user_id));insert into student_registry values('a'),('b'),('c');insert into line_user_aliases values('${a}','登録済みの母');insert into student_line_accounts values('b','${b}','mother','確認済みの登録',false,'human','confirmed');insert into student_line_accounts values('c','${c}','mother','取消済みの登録',false,'human','revoked');insert into student_line_links values('a','${a}'),('b','${b}'),('c','${c}'),('a','synthetic-import-id');`);
  await db.exec(sql);await db.exec(sql);
  const rows=(await db.query('select * from student_line_accounts order by student_number')).rows;assert.equal(rows.length,3);assert.equal(rows[0].alias_name,'登録済みの母');assert.equal(rows[0].verification_status,'unverified');assert.equal(rows[0].relation,'unknown');assert.equal(rows[1].verification_status,'confirmed');assert.equal(rows[2].verification_status,'revoked');
  await db.query('insert into student_line_links values($1,$2)',['b',a]);assert.equal((await db.query('select count(*)::int n from student_line_accounts')).rows[0].n,4);
  await db.query('update student_line_links set student_number=$1 where student_number=$2 and line_user_id=$3',['c','b',a]);assert.equal((await db.query('select count(*)::int n from student_line_accounts')).rows[0].n,5);
 }finally{await db.close();}
});
