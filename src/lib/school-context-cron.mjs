import {createHmac} from 'node:crypto';
/** Uses existing vault credentials, changes only the explicitly named new job. */
export async function scheduleSchoolContextJob({sql,secret,jobName='bentan-school-context-sync',route='/api/cron/school-context-sync',schedule='*/2 * * * *'}){
 if(!['bentan-school-context-sync','bentan-benkei-sync'].includes(jobName)||!['/api/cron/school-context-sync','/api/cron/benkei-sync'].includes(route))throw new Error('invalid_context_cron_job');
 const secrets=(await sql.query("select name,decrypted_secret from vault.decrypted_secrets where name in ('attendance_app_url','attendance_internal_token')")).rows;
 const expected=createHmac('sha256',secret).update('attendance-analysis-cron-v1').digest('hex');
 if(secrets.find(s=>s.name==='attendance_internal_token')?.decrypted_secret!==expected||secrets.find(s=>s.name==='attendance_app_url')?.decrypted_secret!=='https://line-check-system.vercel.app')throw new Error('cron_authentication_mismatch');
 const command=`select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='attendance_app_url') || '${route}', headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='attendance_internal_token'),'Content-Type','application/json'),body := '{}'::jsonb,timeout_milliseconds := 55000);`;
 await sql.query('select cron.schedule($1,$2,$3)',[jobName,schedule,command]);
 return (await sql.query('select jobname,schedule,active from cron.job where jobname=$1',[jobName])).rows;
}
