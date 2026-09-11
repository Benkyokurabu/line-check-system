import {test,expect} from '@playwright/test';

test('staff sees each slot occupancy, closed slots, and refreshed vacancy',async({page})=>{
 let occupied=true;
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'test',staffCode:'KUDO',displayName:'検証職員',role:'admin'}}}));
 await page.route('**/api/staff/study-room-trial/intake-options?**',route=>{
  const date=new URL(route.request().url()).searchParams.get('date');
  return route.fulfill({json:{date,slotIds:['16:45-18:15','18:35-20:05','20:25-21:55'],closedSlotIds:['20:25-21:55'],booked:occupied?[{seat:1,slotId:'16:45-18:15'}]:[]}});
 });
 await page.goto('/staff/self-study-room/trial?staff=KUDO');
 const overview=page.getByRole('region',{name:'時間帯ごとの空席'});
 await expect(overview.getByLabel('16:45–18:15 空き9席')).toBeVisible();
 await expect(overview.getByLabel('18:35–20:05 空き10席')).toBeVisible();
 await expect(overview.getByLabel('20:25–21:55 利用不可')).toBeVisible();
 occupied=false;
 await expect(overview.getByLabel('16:45–18:15 空き10席')).toBeVisible({timeout:12000});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'analysis_outputs/staff-availability-20260911.png',fullPage:true});
});

test('student automatically reflects approval and recovers after network failure',async({page})=>{
 let approved=false,fail=false;
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'test',staffCode:'KUDO',displayName:'検証生徒',role:'admin'}}}));
 await page.route('**/api/staff/study-room-trial/student?**',route=>fail?route.fulfill({status:503,json:{error:'offline'}}):route.fulfill({json:{studentName:'検証生徒',booked:[],closedSlotIds:[],requests:[{id:'test',reservation_date:'2099-01-01',seat:3,slot_ids:['16:45-18:15'],status:approved?'approved':'pending',version:approved?2:1}]}}));
 await page.goto('/self-study-room/trial?staff=KUDO');
 await expect(page.getByRole('heading',{name:'申請を受け付けました'})).toBeVisible();
 await expect(page.getByRole('button',{name:'申請内容を確認する'})).toHaveCount(0);
 fail=true;
 await expect(page.getByRole('region',{name:'申請・予約の状況'}).getByRole('alert')).toContainText('最新の状況を確認できません',{timeout:12000});
 fail=false;approved=true;
 await expect(page.getByRole('heading',{name:'予約が確定しました'})).toBeVisible({timeout:12000});
 await expect(page.getByRole('region',{name:'申請・予約の状況'}).getByRole('alert')).toHaveCount(0);
 await expect(page.getByText('3番席',{exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'analysis_outputs/student-approved-20260911.png',fullPage:true});
 await page.reload();
 await expect(page.getByRole('heading',{name:'予約が確定しました'})).toBeVisible();
});
