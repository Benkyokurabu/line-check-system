import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { initialLoginNames, loginPersonName, addLoginPerson, loginPeople } from '../src/lib/staff-login-directory.mjs';
import { loginAvailabilityTeacher } from '../src/lib/availability-teacher-login.mjs';
test('specified login names preserve order, distinguish both Satos and normalize duplicate spelling',()=>{
 assert.equal(initialLoginNames.length,21);assert.equal(new Set(initialLoginNames).size,21);
 assert.ok(initialLoginNames.includes('髙山'));assert.ok(initialLoginNames.includes('佐藤（治）'));assert.ok(initialLoginNames.includes('佐藤（俊）'));
 assert.deepEqual(loginPersonName(' 佐藤（治） '),{displayName:'佐藤（治）',nameKey:'佐藤(治)'});
 for(const value of ['',null,'<script>','a\nname','x'.repeat(51)])assert.throws(()=>loginPersonName(value));
});
test('non-admin additions and inactive/unregistered login identities cannot reach account creation',async()=>{
 await assert.rejects(addLoginPerson({}, {role:'teacher'},'追加'),error=>error.status===403);
 const db={from(table){assert.equal(table,'staff_login_people');return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:null,error:null};}};}};
 await assert.rejects(loginAvailabilityTeacher({dataClient:db,identityClient:{},teacherId:'00000000-0000-4000-8000-000000000001',password:'fixture'}),error=>error.status===401);
});
test('public directory exposes only display names and IDs with explicit ordering',async()=>{
 const calls=[];const db={from(table){calls.push(table);return {select(columns){calls.push(columns);return this;},eq(column,value){calls.push([column,value]);return this;},order(column){calls.push(column);return this;},then(resolve){resolve({data:[{id:'fixture',display_name:'金城'}],error:null});}};}};
 assert.deepEqual(await loginPeople(db),[{id:'fixture',display_name:'金城'}]);
 assert.deepEqual(calls,['staff_login_people','id,display_name',['active',true],'sort_order','display_name']);
});
test('directory is isolated from teaching roster, repeatable and rejects duplicate names',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  const migration=await readFile(new URL('../supabase/staff_login_people_20261012.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
  await db.query('insert into staff_login_people(display_name,name_key,account_name,sort_order) values($1,$2,$3,1)',['佐藤（治）','佐藤(治)','治彦']);
  await assert.rejects(db.query('insert into staff_login_people(display_name,name_key,account_name,sort_order) values($1,$2,$3,2)',['佐藤(治)','佐藤(治)','治彦']),/duplicate key/);
  assert.equal((await db.query("select has_table_privilege('anon','staff_login_people','SELECT') permitted")).rows[0].permitted,false);
  assert.equal((await db.query("select to_regclass('teachers') present")).rows[0].present,null);
 }finally{await db.close();}
});
