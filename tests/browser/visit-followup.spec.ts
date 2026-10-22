import {test,expect} from '@playwright/test';
import {blankVisitFields} from '../../src/lib/visit-followup-core.mjs';
const studentId='22222222-2222-4222-8222-222222222222',intakeId='33333333-3333-4333-8333-333333333333';
const staff={staffId:'44444444-4444-4444-8444-444444444444',staffCode:'KUDO',role:'admin',displayName:'工藤'};
for(const width of [1280,390])test(`見学後の一括入力は通信失敗・原本競合で入力を保持して再開できる ${width}px`,async({page})=>{
 const student={id:studentId,name:'見本の見学生',number:'2026999',status:'新規問合せ'};
 const payload={studentPageId:studentId,intakePageId:intakeId,recordSelection:'',fields:blankVisitFields(),record:'',intakeNote:'',workLog:{enabled:false,teacher:'',task:'',start:'',end:'',contact:'',content:'',result:''}};
 const options={method:['３者対面'],grade:['中１'],campus:['本校'],classes:['１Ｂ英','１Ｂ数'],visitStaff:[staff.staffId],studentStatus:['新規問合せ','見学中'],intakeStatus:['新規問合せ','見学中']};
 const model={student,payload,entry:null,options,staffOptions:[{id:staff.staffId,name:'工藤'}],intakes:[{id:intakeId,title:'見学の問合せ',status:'新規問合せ',note:'原本の備考とリンクを保持',url:'https://example.invalid'}],records:[],originalBody:'',snapshot:'initial'};
 const calls:Array<Record<string,unknown>>=[];let saved:Record<string,unknown>|null=null,refresh=false;
 await page.setViewportSize({width,height:950});await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));
 await page.route('**/api/staff/visit-followup*',async r=>{
  const q=new URL(r.request().url()).searchParams;
  if(r.request().method()==='POST'){
   const body=r.request().postDataJSON();calls.push(body);
   if(calls.length===1)return r.fulfill({status:503,json:{error:'通信が途切れました。入力は保持しています。'}});
   if(calls.length===2){refresh=true;return r.fulfill({status:409,json:{error:'Notion原本が更新されています。原本を再確認してください。'}});}
   saved={id:body.id,version:1,status:'review',payload:{...body.payload,studentName:student.name},targets:{record:{status:'synced',url:'https://example.invalid/record'},student:{status:'synced'},intake:{status:'review',error:'受付を確認してください。'},mtg:{status:'synced'},workLog:{status:'skipped'}}};
   return r.fulfill({json:{entry:saved}});
  }
  if(q.has('q'))return r.fulfill({json:{students:[student]}});
  if(q.has('entry'))return r.fulfill({json:{...model,entry:saved,payload:saved?.payload??payload,snapshot:'after-save'}});
  if(q.has('student'))return r.fulfill({json:{...model,snapshot:refresh?'refreshed':'initial'}});
  return r.fulfill({json:{entries:saved?[saved]:[]}});
 });
 await page.goto('/staff/visit-followup');await page.getByLabel('生徒名',{exact:true}).fill('見本');await page.getByRole('button',{name:'生徒を探す',exact:true}).click();await page.getByRole('button',{name:/見本の見学生.*新規問合せ/}).click();
 await page.getByRole('combobox',{name:'反映する面談記録',exact:true}).selectOption('new');await expect(page.getByRole('button',{name:'原本を再確認',exact:true})).toBeEnabled();
 await page.getByLabel('打ち合わせの実施日',{exact:true}).fill('2026-10-22');await page.getByLabel('面談記録の見出し',{exact:true}).fill('見学の打合せ');await page.getByRole('combobox',{name:'実際の面談方法',exact:true}).selectOption('３者対面');await page.getByRole('combobox',{name:'面談時の学年',exact:true}).selectOption('中１');
 await page.getByLabel('見学開始日',{exact:true}).fill('2026-10-26');await page.getByLabel('見学終了日',{exact:true}).fill('2026-11-06');await page.getByRole('listbox',{name:'見学クラス',exact:true}).selectOption(['１Ｂ英','１Ｂ数']);await page.getByRole('combobox',{name:'生徒情報の状態',exact:true}).selectOption('見学中');await page.getByRole('combobox',{name:'受付側の状態',exact:true}).selectOption('見学中');
 await page.getByRole('textbox',{name:'面談の詳しい記録（追記）',exact:true}).fill('本人と保護者と見学の予定を相談した。');await page.getByRole('textbox',{name:'受付へ追記する備考',exact:true}).fill('２科目を見学予定。');await page.getByLabel('終業MTGの見出し',{exact:true}).fill('見学開始の報告');
 const submit=()=>page.getByRole('button',{name:'確定した内容を各DB・MTGへ反映',exact:true}).click();
 await submit();await expect(page.getByRole('main').getByRole('alert')).toContainText('通信が途切れ');await expect(page.getByRole('textbox',{name:'面談の詳しい記録（追記）',exact:true})).toHaveValue('本人と保護者と見学の予定を相談した。');
 await submit();await expect(page.getByRole('main').getByRole('alert')).toContainText('原本が更新');expect(calls[0].operationKey).toBe(calls[1].operationKey);
 await page.getByRole('button',{name:'原本を再確認',exact:true}).click();await expect(page.getByRole('status')).toContainText('入力中の内容は保持');await submit();await expect(page.getByRole('heading',{name:'受付DB：確認待ち',exact:true})).toBeVisible();
 expect(calls[2].operationKey).not.toBe(calls[1].operationKey);expect(calls[2].payload).toMatchObject({studentPageId:studentId,intakePageId:intakeId,recordSelection:'new',fields:{classes:{value:'１Ｂ英、１Ｂ数',state:'confirmed'},studentStatus:{value:'見学中',state:'confirmed'},materials:{value:'',state:'unknown'}},workLog:{enabled:false}});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`analysis_outputs/visit-followup-${width}.png`,fullPage:true});
 await page.reload();await page.getByText('保存済みの見学打合せ後の入力を再開',{exact:true}).click();await page.getByRole('button',{name:/2026-10-22.*見本の見学生/}).click();await expect(page.getByRole('textbox',{name:'面談の詳しい記録（追記）',exact:true})).toHaveValue('本人と保護者と見学の予定を相談した。');
});
test('権限のない職員へ入力を出さず、未認証APIを拒否する',async({page,request})=>{
 await page.route('**/api/staff/session',r=>r.fulfill({json:{staff:{...staff,staffCode:'KINJO'}}}));await page.goto('/staff/visit-followup');await expect(page.getByText('工藤先生の確認中です。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'生徒を探す',exact:true})).toHaveCount(0);
 expect((await request.get('/api/staff/visit-followup')).status()).toBe(401);
});
for(const sameStaff of [true,false])test(`ログイン切れの入力を同じ職員だけへ復元する sameStaff=${sameStaff}`,async({page})=>{
 const student={id:studentId,name:'見本の見学生',number:'2026999',status:'新規問合せ'},payload={studentPageId:studentId,intakePageId:intakeId,recordSelection:'new',fields:blankVisitFields(),record:'',intakeNote:'',workLog:{enabled:false,teacher:'',task:'',start:'',end:'',contact:'',content:'',result:''}};
 const model={entry:null,payload,student,snapshot:'snapshot',options:{},staffOptions:[],intakes:[],records:[],originalBody:''};let posts=0;const bodies:Array<Record<string,unknown>>=[];
 await page.route('**/api/staff/session',r=>r.fulfill({json:{staff:posts===0||sameStaff?staff:{...staff,staffId:'55555555-5555-4555-8555-555555555555',staffCode:'KINJO'}}}));
 await page.route('**/api/staff/visit-followup*',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(r.request().method()==='POST'){posts++;const body=r.request().postDataJSON();bodies.push(body);return r.fulfill({status:posts===1?401:503,json:{error:posts===1?'ログインを再確認してください':'通信を再確認してください'}});}
  return r.fulfill({json:q.has('q')?{students:[student]}:q.has('student')?model:{entries:[]}});
 });
 await page.goto('/staff/visit-followup');await page.getByLabel('生徒名',{exact:true}).fill('見本');await page.getByRole('button',{name:'生徒を探す',exact:true}).click();await page.getByRole('button',{name:/見本の見学生.*新規問合せ/}).click();await page.getByRole('textbox',{name:'面談の詳しい記録（追記）',exact:true}).fill('消さずに保持する文章');
 await page.getByRole('button',{name:'確定した内容を各DB・MTGへ反映',exact:true}).click();await expect(page.getByRole('textbox',{name:'面談の詳しい記録（追記）',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'ログイン状態を再確認する',exact:true}).click();
 if(sameStaff){await expect(page.getByRole('textbox',{name:'面談の詳しい記録（追記）',exact:true})).toHaveValue('消さずに保持する文章');await page.getByRole('button',{name:'確定した内容を各DB・MTGへ反映',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('通信を再確認');expect(bodies[0].operationKey).toBe(bodies[1].operationKey);}else{await expect(page.getByText('工藤先生の確認中です。',{exact:true})).toBeVisible();await expect(page.getByText('消さずに保持する文章',{exact:true})).toHaveCount(0);expect(posts).toBe(1);}
});
