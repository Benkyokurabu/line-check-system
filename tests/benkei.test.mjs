import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {readBenkeiItem,announcementBlocks,blockText} from '../src/lib/benkei-core.mjs';
const block=(text,more=false)=>({id:randomUUID(),type:'heading_2',heading_2:{rich_text:[{plain_text:text}]},has_children:more,last_edited_time:'2026-10-22T00:00:00Z'});
test('本文とリンクが変わるとhash変更、編集日時だけでは変更しない',async()=>{
 const root=block('共有連絡',true),child=block('面談記録を確認');const request=async()=>({results:[child],has_more:false});
 const a=await readBenkeiItem(root,request);child.last_edited_time='2026-10-23T00:00:00Z';assert.equal((await readBenkeiItem(root,request)).hash,a.hash);
 child.heading_2.rich_text[0].plain_text='訂正された記録';assert.notEqual((await readBenkeiItem(root,request)).hash,a.hash);
 await assert.rejects(readBenkeiItem(root,async()=>({results:[],has_more:true})),/incomplete/);
});
test('進捗表と下部DBは共有連絡に混入させない',()=>{const a=block('連絡');assert.deepEqual(announcementBlocks([{...a,id:'c8397cca-0e2f-4560-a2bd-68651df1646f'},a,{type:'divider'},block('DB')]),[a]);});
test('内部の復旧リンクを表示本文から外し、業務本文のリンクは残す',()=>{const a=block('本文');a.heading_2.rich_text.push({text:{content:'\n\n勉たんで確認',link:{url:`https://line-check-system.vercel.app/staff/benkei?operation=${randomUUID()}`}}});assert.equal(blockText(a),'本文');a.heading_2.rich_text.push({text:{content:'参照資料',link:{url:'https://www.notion.so/example'}}});assert.match(blockText(a),/参照資料 \(https:\/\/www.notion.so\/example\)/);});
test('確認は本人のみ・版ごと・再実行冪等、別名アカウント共有、一般公開不可',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create table staff_accounts(id uuid primary key,staff_code text,role text,active boolean);create function staff_authorize(uuid,uuid)returns jsonb language sql as $$select jsonb_build_object('staffId',id,'staffCode',staff_code,'role',role) from staff_accounts where id=$1 and active$$;`);
  const sql=await readFile(new URL('../supabase/benkei_home_20261022.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
  const a=randomUUID(),b=randomUUID(),reader=randomUUID(),other=randomUUID(),session=randomUUID(),alias=randomUUID();
  await db.query("insert into staff_accounts values($1,'KUDO','admin',true),($2,'OTHER','teacher',true),($3,$4,'teacher',true)",[a,b,alias,`AVAIL_${reader.replaceAll('-','').toUpperCase()}`]);
  await db.query("insert into bentan_benkei_readers values($1,'甲',true),($2,'乙',true)",[reader,other]);
  await db.query('insert into bentan_benkei_reader_accounts values($1,$2),($3,$4)',[a,reader,b,other]);await db.exec('update bentan_benkei_settings set enabled=true');
  let item=await readBenkeiItem(block('共有事項'),async()=>({results:[]}));const ingest=()=>db.query('select benkei_import($1)',[JSON.stringify([item])]);await ingest();await ingest();
  const list=async who=>(await db.query('select benkei_list($1,$2,false,0) result',[who,session])).rows[0].result;
  const current=(await list(a)).items[0];assert.equal(current.version,1);await assert.rejects(list(b),/permission/);
  const confirm=(version=1,hash=item.hash)=>db.query('select benkei_confirm($1,$2,$3,$4,$5)',[a,session,current.id,version,hash]);
  const hide=(who,dismiss=true)=>db.query('select benkei_set_dismissed($1,$2,$3,$4)',[who,session,[current.id],dismiss]);
  await assert.rejects(hide(a),/conflict/);
  await confirm();await confirm();assert.equal((await list(a)).unreadCount,0);assert.equal((await list(alias)).unreadCount,0);assert.equal((await list(alias)).staff.readerId,reader);assert.equal((await list(a)).items.length,1);
  await hide(a);assert.equal((await list(a)).items.length,0);await hide(a,false);assert.equal((await list(a)).items.length,1);await hide(a);
  await db.exec('update bentan_benkei_settings set trial_only=false');assert.equal((await list(b)).unreadCount,1);assert.equal((await list(b)).items.length,1);await assert.rejects(hide(b),/conflict/);
  item={...item,body:'改訂',hash:'a'.repeat(64)};await ingest();assert.equal((await list(a)).unreadCount,1);await assert.rejects(confirm(1,'b'.repeat(64)),/conflict/);await confirm(2,item.hash);
  const all=(await db.query('select benkei_list($1,$2,true,0) r',[a,session])).rows[0].r;assert.equal(all.items[0].history.length,2);assert.equal(all.items[0].readers.find(r=>r.readerId===other).confirmedAt,null);
  await db.exec('set role anon');await assert.rejects(db.query('select * from bentan_benkei_items'),/permission/);await db.exec('reset role');
 }finally{await db.close();}
});
