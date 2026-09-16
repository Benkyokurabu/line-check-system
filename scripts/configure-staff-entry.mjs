import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
const envPath=path.resolve(process.argv.includes('--env')?process.argv[process.argv.indexOf('--env')+1]:'.env.local');
const env={};for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const project=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const password=env.SUPABASE_DB_PASSWORD||fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8').trim().split(/\r?\n/)[0];
let db;
for(const host of [`db.${project}.supabase.co`,'aws-0-ap-northeast-1.pooler.supabase.com','aws-1-ap-northeast-1.pooler.supabase.com']){
 const c=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000});
 try{await c.connect();db=c;break;}catch{await c.end().catch(()=>{});}
}
if(!db)throw Error('DB接続に失敗しました。');
const dir=path.resolve('analysis_outputs/staff-entry-20260916');fs.mkdirSync(dir,{recursive:true});
const materialFile=path.join(dir,'entry-private.json');
const material=fs.existsSync(materialFile)?JSON.parse(fs.readFileSync(materialFile,'utf8')):{};
try{
 const existing=(await db.query("select to_regclass('public.staff_entry_keys') present")).rows[0].present;
 const backup={at:new Date().toISOString(),keys:existing?(await db.query('select * from staff_entry_keys')).rows:[],accounts:(await db.query("select staff_code,auth_user_id,active,auth_not_before from staff_accounts where staff_code in ('KUDO','KINJO')")).rows};
 fs.writeFileSync(path.join(dir,`before_${Date.now()}.json`),JSON.stringify(backup,null,2));
 if(backup.accounts.length!==2||backup.accounts.some(r=>!r.active||!r.auth_user_id))throw Error('対象の有効な職員を確認できません');
 await db.query('begin');await db.query("set local lock_timeout='5s'");
 const sql=fs.readFileSync(new URL('../supabase/staff_entry_20260916.sql',import.meta.url),'utf8').replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');await db.query(sql);
 if(process.argv.includes('--apply')){
  for(const code of ['KUDO','KINJO']){
   const current=(await db.query('select key_hash,enabled,expires_at from staff_entry_keys where staff_code=$1',[code])).rows[0];
   if(!material[code]){if(current)throw Error('既存キーの記録がありません。上書きせず停止します');material[code]={key:randomBytes(32).toString('base64url')};fs.writeFileSync(materialFile,JSON.stringify(material,null,2));}
   const hash=createHash('sha256').update(material[code].key).digest('hex');
   if(current){if(current.key_hash!==hash||!current.enabled||Date.parse(current.expires_at)<Date.now())throw Error('既存キーが変更・停止されています');}
   else await db.query('insert into staff_entry_keys(staff_code,key_hash) values($1,$2)',[code,hash]);
  }
  await db.query('commit');console.log(JSON.stringify({applied:true,accounts:['KUDO','KINJO'],secretStoredLocally:true}));
 }else{await db.query('rollback');console.log(JSON.stringify({applied:false,rollbackVerified:true}));}
}catch(e){await db.query('rollback').catch(()=>{});throw e;}finally{await db.end();}
