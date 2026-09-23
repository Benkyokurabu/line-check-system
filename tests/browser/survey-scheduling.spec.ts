import {test,expect} from '@playwright/test';
const ids=['11111111111141118111111111111111','22222222222242228222222222222222','33333333333343338333333333333333'];
const students=ids.map((id,i)=>({grade:'中3',name:`日程確認${i+1}`,notionUrl:`https://app.notion.com/p/${id}`,submittedAt:'2026-09-23'}));
test('面談日程は対応状況と独立し、日時・絞り込み・復帰時更新・取得失敗を表示する',async({page})=>{
 let failed=false,answered=false;
 await page.route('**/api/interview-surveys',r=>r.fulfill({json:{groups:[{teacher:'工藤',students}]}}));
 await page.route('**/api/interview-surveys/confirmations',r=>r.fulfill({json:{states:[{page_id:ids[0],confirmed:true,version:1}]}}));
 await page.route('**/api/interview-surveys/scheduling',r=>failed?r.fulfill({status:503,json:{error:'unavailable'}}):r.fulfill({json:{states:{[ids[0]]:{status:'uncontacted',detail:'日程の打診はまだありません。'},[ids[1]]:{status:'invited',detail:answered?'返信あり・先生の承認待ち':'返信待ち'},[ids[2]]:{status:'confirmed',detail:'日程が確定しています。',date:'2026-09-30',start:'16:00',end:'16:45'}},updatedAt:'2026-09-23T12:00:00Z'}}));
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'工藤先生 3'}).click();
 const list=page.getByRole('list',{name:'工藤先生のアンケート回答'});
 const handled=list.getByRole('listitem').filter({hasText:'日程確認1'});await expect(handled.getByRole('button',{name:'対応済み',exact:true})).toBeVisible();await expect(handled.getByRole('link',{name:'日程確認1：未連絡・候補日時を選ぶ'})).toHaveAttribute('href',`/staff/interviews?tab=invitations&answer=${ids[0]}`);
 await expect(list.getByText('打診済み',{exact:true})).toBeVisible();await expect(list.getByText('2026-09-30 16:00〜16:45')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'analysis_outputs/survey-scheduling-mobile.png',fullPage:true});
 await page.getByRole('combobox',{name:'面談日程',exact:true}).selectOption('invited');await expect(list.getByRole('listitem')).toHaveCount(1);
 answered=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(list.getByText('返信あり・先生の承認待ち')).toBeVisible();
 failed=true;await page.getByRole('button',{name:'日程状況を再取得',exact:true}).click();await expect(page.getByText('日程状況を取得できません。再取得してください。',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'面談日程',exact:true}).selectOption('');await expect(list.getByText('要確認',{exact:true})).toHaveCount(3);await expect(list.getByText('未連絡',{exact:true})).toHaveCount(0);
});
test('日程状況APIは未ログインのアクセスを拒否する',async({request})=>{
 expect((await request.get('/api/interview-surveys/scheduling')).status()).toBe(401);
});

test('未連絡から対象生徒のNotion候補日時へ直接進み、送信制限は維持する',async({page})=>{
 const studentId='11111111-1111-4111-8111-111111111111';let slotReads=0;
 await page.route('**/api/interview-surveys',r=>r.fulfill({json:{groups:[{teacher:'工藤',students:[students[0]]}]}}));
 await page.route('**/api/interview-surveys/confirmations',r=>r.fulfill({json:{states:[]}}));
 await page.route('**/api/interview-surveys/scheduling',r=>r.fulfill({json:{states:{[ids[0]]:{status:'uncontacted',detail:'未連絡'}},updatedAt:'2026-09-23'}}));
 await page.route('**/api/staff/session',r=>r.fulfill({json:{staff:{staffId:'staff',staffCode:'KUDO',displayName:'工藤',role:'admin'}}}));
 await page.route('**/api/staff/interview-requests*',r=>r.fulfill({json:{requests:[],bookings:[],slots:[],snapshot:'s',loginReady:true}}));
 await page.route('**/api/staff/interview-invitations*',r=>{
  if(r.request().url().includes('slots=1')){slotReads++;expect(new URL(r.request().url()).searchParams.get('studentId')).toBe(studentId);return r.fulfill({json:{slots:[{id:'slot',version:1,studentId,date:'2030-01-03',start:'13:00',end:'13:45',teacher:'工藤'}],fetchedAt:'2026-09-23'}});}
  return r.fulfill({json:{students:[{id:studentId,number:'2018123',name:students[0].name,teacher:'工藤',grade:'中3',pilot:false,surveys:[{round:'2026-autumn',status:'submitted',responses:[{id:ids[0],date:'2026-09-23',url:students[0].notionUrl,fields:[]}]}]}],rounds:[{id:'2026-autumn',label:'2026年 秋のアンケート'}],invitations:[],notifications:[],pilotReady:true}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'工藤先生 1'}).click();await page.getByRole('link',{name:'日程確認1：未連絡・候補日時を選ぶ'}).click();
 await expect(page.getByRole('heading',{name:'打診する候補日時を選ぶ'})).toBeVisible();await expect(page.getByRole('heading',{name:'日程確認1さん',exact:true})).toBeVisible();
 await page.getByRole('checkbox',{name:'13:00〜13:45',exact:true}).check();expect(slotReads).toBe(1);await expect(page.getByRole('button',{name:'LINEで日程を打診する（工藤のみ）'})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'analysis_outputs/survey-direct-slots.png',fullPage:true});
});
