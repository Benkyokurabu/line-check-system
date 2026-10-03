import test from 'node:test';
import assert from 'node:assert/strict';
import {surveyMeetingCampus} from '../src/lib/survey-meeting-campus.mjs';
const dbFor=(data,error=null)=>({from:()=>({select:()=>({eq:()=>({limit:async()=>({data,error})})})})});
test('meeting campus uses the same teacher schedule decision as generated availability',async()=>{
 const rows=[{teacher_name:'工藤',campus:'南教室',start_time:'5:00〜6:30',subject:'数学'},{teacher_name:'金城',campus:'本校',start_time:'5:00〜6:30',subject:'数学'}];
 assert.equal(await surveyMeetingCampus(dbFor(rows),'2026-10-08','工藤先生'),'南教室');
 assert.equal(await surveyMeetingCampus(dbFor([]),'2026-10-08','工藤'),'');
});
test('ambiguous schedule campuses and failed reads stop rather than guessing',async()=>{
 const rows=['本校','南教室'].map(campus=>({teacher_name:'工藤',campus,start_time:'5:00〜6:30',subject:'数学'}));
 await assert.rejects(()=>surveyMeetingCampus(dbFor(rows),'2026-10-08','工藤'),/実際に勤務する校舎/);
 await assert.rejects(()=>surveyMeetingCampus(dbFor([],{}),'2026-10-08','工藤'),/確認できません/);
});
