import fs from 'node:fs';import {connectBenkeiDatabase,loadBenkeiEnvironment} from './benkei-db.mjs';
loadBenkeiEnvironment();const args=process.argv.slice(2),db=await connectBenkeiDatabase();
try{
 if(args.includes('--schema')&&args.includes('--apply')){
  await db.query('begin');await db.query("set local lock_timeout='8s'");
  const before=(await db.query('select staff_code,role,active from staff_accounts order by staff_code')).rows;
  await db.query(fs.readFileSync('supabase/benkei_authoring_20261022.sql','utf8'));
  const after=(await db.query('select staff_code,role,active from staff_accounts order by staff_code')).rows;if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('staff_changed');
  const rights=(await db.query("select has_table_privilege('anon','bentan_benkei_authoring_operations','select') a,has_table_privilege('authenticated','bentan_benkei_authoring_sources','select') b,has_function_privilege('anon','benkei_authoring_claim(uuid,boolean)','execute') c")).rows[0];if(Object.values(rights).some(Boolean))throw new Error('public_access');
  await db.query('commit');console.log(JSON.stringify({schemaApplied:true,staffUnchanged:true,externalSourceWrites:0}));
 }else{
  const exists=(await db.query("select to_regclass('public.bentan_benkei_authoring_operations') is not null present")).rows[0].present;
  console.log(JSON.stringify({dryRun:true,schemaAvailable:exists,...(exists?{operations:(await db.query('select status,count(*)::int n from bentan_benkei_authoring_operations group by status')).rows}:{}),externalSourceWrites:0}));
 }
}catch{await db.query('rollback').catch(()=>{});console.error('benkei_authoring_admin_failed');process.exitCode=1;}finally{await db.end();}
