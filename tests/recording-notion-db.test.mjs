import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('automatic capture preserves explicit settings and keeps original URLs private',async()=>{
 const db=new PGlite();
 try{
 await db.exec("create role anon;create role authenticated;create role service_role;create table staff_accounts(id uuid primary key,staff_code text,active boolean,role text);insert into staff_accounts values('00000000-0000-0000-0000-000000000001','KUDO',true,'admin');");
 await db.exec(fs.readFileSync('supabase/recording_publication_20261002.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/recording_notion_publication_20261002.sql','utf8'));
 const key='2026-10-01|18:00～19:00|hon|hon_j1_S_math|1',page='00000000-0000-0000-0000-000000000002',owner='00000000-0000-0000-0000-000000000001';
 await db.query('select capture_test_recording($1,$2,$3,$4)',[key,'https://example.test/original','{}',page]);
 let row=(await db.query('select * from recording_publications')).rows[0];
 assert.equal(row.mode,'notion');assert.equal(row.automatic,true);assert.equal(row.notion_page_id,page);
 await db.query("select save_recording_publication($1,$2,$3,$4,$5,'private',null,$6,$7,null)",[key,JSON.stringify([key]),row.source_url,JSON.stringify(row.source_urls),'{}',row.version,owner]);
 await db.query('select capture_test_recording($1,$2,$3,$4)',[key,'https://example.test/new','{}',page]);
 row=(await db.query('select * from recording_publications')).rows[0];
 assert.equal(row.mode,'private');assert.equal(row.automatic,false);assert.equal(row.source_url,'https://example.test/original');assert(row.source_urls.includes('https://example.test/new'));
 const perms=(await db.query("select has_table_privilege('anon','recording_publications','select') as read,has_function_privilege('anon','capture_test_recording(text,text,jsonb,text)','execute') as write")).rows[0];
 assert.equal(perms.read,false);assert.equal(perms.write,false);
 }finally{await db.close();}
});
