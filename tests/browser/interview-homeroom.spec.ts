import {test,expect} from '@playwright/test';
for(const endpoint of ['/api/parent/interviews','/api/staff/interview-live-preview'])test(`担任と翌日の空き枠を自動表示: ${endpoint}`,async({page})=>{
 await page.clock.install({time:new Date('2026-09-21T23:59:00+09:00')});
 await page.route('**/api/**',route=>{
  if(new URL(route.request().url()).pathname===endpoint)return route.fulfill({json:{students:[{id:'one',name:'確認用生徒',teacher:'工藤'},{id:'two',name:'確認用きょうだい',teacher:'金城'}],slots:[{id:'slot-one',studentId:'one',date:'2026-09-22',start:'13:00',end:'13:45'},{id:'slot-two',studentId:'two',date:'2026-09-23',start:'14:00',end:'14:45'}],requests:[]}});
  return route.fulfill({json:{}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto(endpoint.includes('live-preview')?'/interviews/trial':'/interviews');
 await expect(page.getByText('担任：工藤先生')).toBeVisible();
 await expect(page.getByRole('button',{name:'9月22日(火) 13:00〜13:45'})).toBeVisible();
 await expect(page.getByRole('button',{name:/9月23日/})).toHaveCount(0);
 await page.getByRole('combobox',{name:'お子さま'}).selectOption('two');
 await expect(page.getByText('担任：金城先生')).toBeVisible();
 await expect(page.getByRole('button',{name:/9月22日/})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'9月23日(水) 14:00〜14:45'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('申請中も翌日以降の空き日程を確認でき、重複申請はできない',async({page})=>{
 await page.route('**/api/parent/interviews',r=>r.fulfill({json:{students:[{id:'one',name:'確認用生徒',teacher:'工藤'}],slots:[{id:'slot',studentId:'one',date:'2030-01-02',start:'13:00',end:'13:45'}],requests:[{id:'request',studentId:'one',status:'pending',version:1,choices:[{slotId:'old',date:'2026-09-19',start:'13:00',end:'13:45'}],note:'',reason:'',confirmed:null}]}}));
 await page.goto('/interviews');await expect(page.getByRole('heading',{name:'担任の空き日程'})).toBeVisible();
 await expect(page.getByRole('button',{name:/1月2日/})).toBeDisabled();
 await expect(page.getByRole('button',{name:'選んだ日程を確認する'})).toHaveCount(0);
 await expect(page.getByText('承認待ち',{exact:true})).toBeVisible();
});
