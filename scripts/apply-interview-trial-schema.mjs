import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const envPath=path.resolve(process.argv.includes('--env')?process.argv[process.argv.indexOf('--env')+1]:'.env.local');
process.loadEnvFile(envPath);
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const password=process.env.SUPABASE_DB_PASSWORD||fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8').trim().split(/\r?\n/)[0];
let db;
for(const host of [`db.${project}.supabase.co`,'aws-0-ap-northeast-1.pooler.supabase.com','aws-1-ap-northeast-1.pooler.supabase.com']){
 const c=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000});
 try{await c.connect();db=c;break;}catch{await c.end().catch(()=>{});}
}
if(!db)throw Error('確認用DBへ接続できません。');
try{
 const exists=(await db.query("select to_regclass('public.staff_interview_trial_state') present")).rows[0].present;
 const backup={at:new Date().toISOString(),existed:!!exists,rows:exists?(await db.query('select * from public.staff_interview_trial_state')).rows:[]};
 const dir='analysis_outputs/interview-deployment';fs.mkdirSync(dir,{recursive:true});const file=`${dir}/database.before_interview_trial_${Date.now()}.json`;fs.writeFileSync(file,JSON.stringify(backup,null,2),{flag:'wx'});
 if(process.argv.includes('--apply'))await db.query(fs.readFileSync(new URL('../supabase/interview_trial_20260914.sql',import.meta.url),'utf8'));
 console.log(JSON.stringify({applied:process.argv.includes('--apply'),backup:file,previousRows:backup.rows.length}));
}finally{await db.end();}
