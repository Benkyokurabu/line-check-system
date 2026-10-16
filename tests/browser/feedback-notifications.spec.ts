import {expect,test} from '@playwright/test';
test('owner sees a new-count entry, reviews explicitly, and can still find reviewed requests',async({page})=>{
 let reviewed=false;const writes:unknown[]=[];
 const row={id:'debb627b-402b-4a79-973e-0dcf0cd12de3',sender_name:'確認用の職員',message:'新しい改善要望です。',created_at:'2026-10-16T07:00:00Z',sharing_preference:'anonymous',notification_status:'sent'};
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/private-feedback/summary')return route.fulfill({json:{unreviewedCount:reviewed?0:1}});
  if(url.pathname==='/api/private-feedback'){
   if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());reviewed=true;return route.fulfill({json:{unreviewedCount:0}});}
   const show=url.searchParams.get('unreviewed')!=='true'||!reviewed;
   return route.fulfill({json:{feedback:show?[{...row,reviewed_at:reviewed?'2026-10-16T08:00:00Z':null}]:[],unreviewedCount:reviewed?0:1,hasMore:false}});
  }
  return route.abort();
 });
 await page.goto('/');
 await expect(page.getByText('未確認の改善要望が1件あります')).toBeVisible();
 await page.getByRole('link',{name:/改善要望を確認する/}).click();
 await expect(page.getByRole('heading',{level:1,name:'改善要望の確認'})).toBeVisible();
 await expect(page.getByText(row.message,{exact:true})).toBeVisible();expect(writes).toHaveLength(0);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'analysis_outputs/feedback-notifications/inbox-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'確認済みにする',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('未確認 0件');expect(writes).toEqual([{id:row.id}]);
 await expect(page.getByText(row.message,{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'すべて',exact:true}).click();
 await expect(page.getByText(row.message,{exact:true})).toBeVisible();
 await expect(page.getByText('確認済み',{exact:true})).toBeVisible();
 await expect(page.getByText(/匿名希望：他の職員/)).toBeVisible();
});
test('other staff cannot see owner notification counts or the owner banner',async({page})=>{
 await page.route('**/api/**',route=>route.fulfill({status:403,json:{error:'権限なし'}}));
 await page.goto('/');
 await expect(page.getByRole('region',{name:'工藤専用の改善要望'})).toHaveCount(0);
 await expect(page.locator('a[href="/private-feedback"]')).toHaveCount(0);
 await page.goto('/private-feedback');
 await expect(page.getByLabel('工藤のパスワード')).toBeVisible();
 await expect(page.getByRole('button',{name:'確認済みにする'})).toHaveCount(0);
});
test('the owner entry and count fit on narrow screens without revealing request bodies on home',async({page})=>{
 await page.route('**/api/**',route=>route.fulfill({json:{unreviewedCount:123}}));
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.getByText('未確認の改善要望が123件あります')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'analysis_outputs/feedback-notifications/home-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});
 await page.screenshot({path:'analysis_outputs/feedback-notifications/home-desktop.png',fullPage:true});
});
