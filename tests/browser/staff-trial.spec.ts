import {test,expect} from '@playwright/test';
import {createStaffStudyRoomTrial} from '../../src/lib/staff-study-room-trial.mjs';

test('office trial uses actual staff components without reservation API writes',async({page})=>{
  let loggedIn=false;
  const room=createStaffStudyRoomTrial();
  const forbidden:string[]=[];
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/staff/study-room-trial/')){
      try{const json=room.handle(url.pathname.replace('/study-room-trial/','/study-room/')+url.search,{method:route.request().method(),body:route.request().postData()},{role:'office',staffCode:'TEST',displayName:'検証事務担当'});await route.fulfill({json});}
      catch(error){await route.fulfill({status:(error as {status:number}).status,json:{error:(error as Error).message}});}
      return;
    }
    if(url.pathname!=='/api/staff/session'){forbidden.push(url.pathname);await route.abort();return;}
    if(route.request().method()==='POST')loggedIn=true;
    if(route.request().method()==='DELETE'){loggedIn=false;await route.fulfill({json:{loggedOut:true}});return;}
    await route.fulfill({status:loggedIn?200:401,json:loggedIn?{staff:{staffId:'office-trial',staffCode:'TEST',displayName:'検証事務担当',role:'office'}}:{error:'ログインしてください。'}});
  });
  await page.goto('/staff/self-study-room/trial');
  await expect(page.getByText('これは検証用です。実際の予約・通知は発生しません。')).toBeVisible();
  await page.getByRole('button',{name:'工藤さんの入口',exact:true}).click();
  await page.getByLabel('パスワード').fill('only-a-test');
  await page.getByRole('button',{name:'ログイン',exact:true}).click();
  await expect(page.getByText('検証事務担当 さん ／ 事務部')).toBeVisible();
  await page.getByRole('button',{name:'一覧を更新',exact:true}).click();
  await page.getByRole('button',{name:'承認して確定',exact:true}).click();
  await page.getByRole('button',{name:'内容を確認して実行',exact:true}).click();
  await expect(page.locator('article').getByText('確定',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'来室・退室を記録',exact:true}).click();
  await page.getByRole('button',{name:'現在時刻を開始欄へ入れる'}).click();
  await page.getByRole('button',{name:'記録内容を確認',exact:true}).click();
  await page.getByRole('button',{name:'確認して記録を保存',exact:true}).click();
  await expect(page.locator('article').getByText(/来室：/)).not.toHaveText('来室：未確認');
  await page.getByRole('button',{name:'ログアウト',exact:true}).click();
  await expect(page.getByRole('button',{name:/入口|選び直す/}).first()).toBeVisible();
  await expect(page.locator('article')).toHaveCount(0);
  expect(forbidden).toEqual([]);
});

test('trial refuses a staff member without admin or office role',async({page})=>{
  await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'teacher',staffCode:'T',displayName:'講師',role:'teacher'}}}));
  await page.route('**/api/staff/study-room-trial/**',route=>route.fulfill({status:403,json:{error:'この操作を行う権限がありません。'}}));
  await page.goto('/staff/self-study-room/trial');
  await page.getByRole('button',{name:'一覧を更新',exact:true}).click();
  await expect(page.getByText('この操作を行う権限がありません。')).toBeVisible();
  await expect(page.locator('article')).toHaveCount(0);
});

test('student trial submits, sees approval from another screen, then cancels',async({page})=>{
  const room=createStaffStudyRoomTrial(null,true);
  const staff={staffId:'kudo',staffCode:'KUDO',displayName:'工藤',role:'admin'};
  const forbidden:string[]=[];
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/staff/session'){await route.fulfill({json:{staff}});return;}
    if(url.pathname!=='/api/staff/study-room-trial/student'){forbidden.push(url.pathname);await route.abort();return;}
    if(route.request().method()==='GET'){await route.fulfill({json:{studentName:'工藤',requests:room.snapshot().rows,booked:[],closedSlotIds:['20:25-21:55']}});return;}
    const input=route.request().postDataJSON();
    const body=input.action==='submit'?{...input,studentNumber:'TRIAL-KUDO',contactChannel:'other',note:'生徒役'}:{...input,action:'cancel'};
    await route.fulfill({json:room.handle(`/api/staff/study-room/${input.action==='submit'?'intake':'transition'}`,{method:'POST',body:JSON.stringify(body)},staff)});
  });
  await page.goto('/self-study-room/trial');
  await expect(page.getByRole('heading',{name:'自習室の予約',exact:true})).toBeVisible();
  await expect(page.getByText('管理者',{exact:false})).toHaveCount(0);
  await expect(page.locator('a[href*="/staff/"]')).toHaveCount(0);
  await page.getByRole('button',{name:'空席・申請状況を更新'}).click();
  await page.getByRole('checkbox',{name:'14:55-16:25',exact:true}).check();
  await page.getByRole('button',{name:'申請内容を確認'}).click();
  await page.getByRole('button',{name:'この内容で申請'}).click();
  await expect(page.locator('article').getByText('承認待ち',{exact:true})).toBeVisible();
  const row=room.snapshot().rows[0];
  room.handle('/api/staff/study-room/transition',{method:'POST',body:JSON.stringify({operationKey:'office-approval',requestId:row.id,expectedVersion:1,action:'approve'})},{role:'office',staffCode:'OFFICE',displayName:'事務担当'});
  await page.getByRole('button',{name:'空席・申請状況を更新'}).click();
  await expect(page.locator('article').getByText('予約確定',{exact:true})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'この申請を取り消す'}).click();
  await expect(page.locator('article').getByText('取消済み',{exact:true})).toBeVisible();
  expect(forbidden).toEqual([]);
});
