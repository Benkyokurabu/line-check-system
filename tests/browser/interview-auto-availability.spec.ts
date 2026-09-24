import {test,expect} from '@playwright/test';

const base={month:'2026-10',teacher:'工藤',lessonDays:2,hash:'a'.repeat(64)};
test('独立メニューで翌月表を同期し、確認後だけ本人の予約可を反映する',async({page})=>{
 let synced=false,applied=false,posts=0;
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000001',staffCode:'KUDO',displayName:'工藤謙',role:'admin'}}}));
 await page.route('**/api/schedule/sync?*',route=>{synced=true;return route.fulfill({json:{status:'unchanged',message:'原本と登録済み授業は一致しています。'}});});
 await page.route('**/api/staff/interview-auto-availability*',route=>{
  if(new URL(route.request().url()).searchParams.get('overview')==='1')return route.fulfill({json:{month:'2026-10',teachers:[{teacher:'工藤',status:applied?'review':'not-run',lessonDays:2,activeSlots:applied?1:0,reviewCount:applied?1:0,finishedAt:applied?'2026-09-24T10:00:00Z':null}]}});
  expect(synced).toBe(true);if(route.request().method()==='POST'){posts++;applied=true;expect(route.request().postDataJSON()).toMatchObject({month:'2026-10',previewHash:'a'.repeat(64)});return route.fulfill({json:{saved:{applied:[{action:'create'}]}}});}
  return route.fulfill({json:applied?{...base,summary:{create:0,update:0,archive:0,keep:1,skip:0,review:1},items:[{key:'2026-10-04|14:00',date:'2026-10-04',start:'14:00',end:'14:45',campus:'本校',action:'keep',reason:'変更なし'},{key:'2026-10-10|review',date:'2026-10-10',start:'',end:'',campus:'',action:'review',reason:'同日に複数校舎の授業があります。'}]}:{...base,summary:{create:1,update:0,archive:0,keep:0,skip:0,review:1},items:[{key:'2026-10-04|14:00',date:'2026-10-04',start:'14:00',end:'14:45',campus:'本校',action:'create',reason:'新しく作成'},{key:'2026-10-10|review',date:'2026-10-10',start:'',end:'',campus:'',action:'review',reason:'同日に複数校舎の授業があります。'}]}});
 });
 await page.goto('/staff/interview-availability');await page.getByRole('button',{name:'スケジュール表から枠を確認'}).click();
 const preview=page.locator('[aria-label="予約可の反映予定"]');await expect(preview).toContainText('作成 1');await expect(preview).toContainText('要確認 1');await expect(preview).toContainText('2026-10-04 14:00〜14:45');expect(posts).toBe(0);
 await page.getByRole('button',{name:'この内容をNotionへ反映'}).click();const dialog=page.getByRole('dialog',{name:'予約可の反映確認'});await expect(dialog).toContainText('作成 1件');await dialog.getByRole('button',{name:'Notionへ反映する'}).click();
 await expect(page.getByRole('status')).toContainText('1件をNotionへ反映しました');expect(posts).toBe(1);await expect(preview).toContainText('変更なし 1');await expect(page.getByRole('region',{name:'先生別の月次実行状況'})).toContainText('工藤先生：要確認あり');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('金城は独立メニューで自分の受付枠だけを確認する',async({page})=>{
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000002',staffCode:'KINJO',displayName:'金城正樹',role:'admin'}}}));
 await page.route('**/api/staff/interview-auto-availability?*',route=>new URL(route.request().url()).searchParams.get('overview')==='1'?route.fulfill({json:{month:'2026-10',teachers:[]}}):route.fulfill({json:{...base,teacher:'金城',summary:{create:0,update:0,archive:0,keep:0,skip:0,review:0},items:[]}}));
 await page.route('**/api/schedule/sync?*',route=>route.fulfill({json:{status:'unchanged',message:'同期済み'}}));await page.goto('/staff/interview-availability');await expect(page.getByRole('heading',{name:'金城正樹さんの受付枠'})).toBeVisible();await page.getByRole('button',{name:'スケジュール表から枠を確認'}).click();await expect(page.locator('[aria-label="予約可の反映予定"]')).toContainText('金城先生');
});
