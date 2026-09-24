import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {BENSUKE_SOURCE,assertNoNotionConflicts,bookingSchema,queryPages,scheduleProperties,scheduleValue,staffDirectory,teacherMatch} from '../src/lib/bensuke-booking.mjs';
import {defaults} from '../src/lib/interview-core.mjs';
import {planTeacherAvailability} from '../src/lib/bensuke-availability-auto.mjs';

const args=process.argv.slice(2),option=(name,fallback='')=>{const index=args.indexOf(name);return index>=0?args[index+1]:fallback;};
const date=option('--date'),teacher=option('--teacher'),apply=args.includes('--apply'),envFile=option('--env','.env.local');
if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!teacher)throw Error('--date YYYY-MM-DD と --teacher が必要です。');
for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^["']|["']$/g,'');}
if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY||!process.env.NOTION_TOKEN)throw Error('Supabase・Notionの接続設定が必要です。');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const notion=async(path,init={})=>{const response=await fetch(`https://api.notion.com/v1${path}`,{...init,headers:{Authorization:`Bearer ${process.env.NOTION_TOKEN}`,'Content-Type':'application/json','Notion-Version':'2025-09-03',...(init.headers??{})}});const body=await response.json();if(!response.ok)throw Error(body.message??`Notion ${response.status}`);return body;};
const read=async query=>{const {data,error}=await query;if(error)throw error;return data??[];};
const [lessons,bookings,settingsRows,schema]=await Promise.all([
 read(db.from('lessons').select('lesson_date,start_time,campus,teacher_name').eq('lesson_date',date)),
 read(db.from('interview_bookings').select('id,status,data').contains('data',{date})),
 read(db.from('interview_settings').select('data').limit(1)),
 notion(`/data_sources/${BENSUKE_SOURCE}`),
]);
const settings=settingsRows[0]?.data??defaults,directory=await staffDirectory(notion,schema),staff=teacherMatch(teacher,directory),property=bookingSchema(schema);
const planned=planTeacherAvailability({date,teacher,lessons,bookings,settings});
const existingPages=await queryPages(notion,BENSUKE_SOURCE,{property:property.date.id,date:{equals:date}});
const exact=new Set(existingPages.flatMap(page=>{const value=scheduleValue(page,schema);return value.teachers.includes(staff.id)&&value.date?.start&&value.date?.end?[`${new Date(value.date.start).toISOString()}|${new Date(value.date.end).toISOString()}`]:[];}));
const ready=planned.filter(row=>!exact.has(`${new Date(`${row.date}T${row.start}:00+09:00`).toISOString()}|${new Date(`${row.date}T${row.end}:00+09:00`).toISOString()}`));
for(const row of ready)assertNoNotionConflicts(existingPages,{schema,data:{...row,room:''},teacherId:staff.id,excludeId:''});
if(!apply){console.log(JSON.stringify({mode:'preview',date,teacher,planned:planned.map(({campus,start,end})=>({campus,start,end})),alreadyExists:planned.length-ready.length,willCreate:ready.length},null,2));process.exit(0);}
const created=[];
for(const row of ready){
 const fresh=await queryPages(notion,BENSUKE_SOURCE,{property:property.date.id,date:{equals:date}});
 const duplicate=fresh.some(page=>{const value=scheduleValue(page,schema);return value.teachers.includes(staff.id)&&value.date?.start&&value.date?.end&&new Date(value.date.start).toISOString()===new Date(`${row.date}T${row.start}:00+09:00`).toISOString()&&new Date(value.date.end).toISOString()===new Date(`${row.date}T${row.end}:00+09:00`).toISOString();});
 if(duplicate)continue;
 assertNoNotionConflicts(fresh,{schema,data:{...row,room:''},teacherId:staff.id,excludeId:''});
 const prefix=row.campus==='本校'?'本':'南',value={title:`${prefix}：${teacher}予約可`,date:{start:`${row.date}T${row.start}:00+09:00`,end:`${row.date}T${row.end}:00+09:00`,time_zone:null},teachers:[staff.id],campuses:[row.campus],room:'',tags:[`${prefix}：予約可`]};
 const page=await notion('/pages',{method:'POST',body:JSON.stringify({parent:{type:'data_source_id',data_source_id:BENSUKE_SOURCE},properties:scheduleProperties(value,schema)})});
 created.push({id:page.id,campus:row.campus,start:row.start,end:row.end});
}
console.log(JSON.stringify({mode:'apply',date,teacher,created,skipped:planned.length-created.length},null,2));
