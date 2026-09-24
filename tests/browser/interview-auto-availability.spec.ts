import {test,expect} from '@playwright/test';

const base={month:'2026-10',teacher:'工藤',lessonDays:2,hash:'a'.repeat(64)};
const state={snapshot:'snapshot',requests:[],bookings:[],slots:[],loginReady:true};
test('フォルダの翌月表を同期し、確認後だけ工藤の予約可を反映する',async({page})=>{
 let synced=false,applied=false,posts=0;
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000001',staffCode:'KUDO',displayName:'工藤謙',role:'admin'}}}));
 await page.route('**/api/staff/interview-requests**',route=>route.fulfill({json:new URL(route.request().url()).searchParams.get('offers')==='1'?{offers:[]}:state}));
 await page.route('**/api/schedule/sync?*',route=>{synced=true;return route.fulfill({json:{status:'unchanged',message:'原本と登録済み授業は一致しています。'}});});
 await page.route('**/api/staff/interview-auto-availability*',route=>{
  expect(synced).toBe(true);if(route.request().method()==='POST'){posts++;applied=true;expect(route.request().postDataJSON()).toMatchObject({month:'2026-10',previewHash:'a'.repeat(64)});return route.fulfill({json:{saved:{applied:[{action:'create'}]}}});}
  return route.fulfill({json:applied?{...base,summary:{create:0,update:0,archive:0,keep:1,skip:0,review:1},items:[{key:'2026-10-04|14:00',date:'2026-10-04',start:'14:00',end:'14:45',campus:'本校',action:'keep',reason:'変更なし'},{key:'2026-10-10|review',date:'2026-10-10',start:'',end:'',campus:'',action:'review',reason:'同日に複数校舎の授業があります。'}]}:{...base,summary:{create:1,update:0,archive:0,keep:0,skip:0,review:1},items:[{key:'2026-10-04|14:00',date:'2026-10-04',start:'14:00',end:'14:45',campus:'本校',action:'create',reason:'新しく作成'},{key:'2026-10-10|review',date:'2026-10-10',start:'',end:'',campus:'',action:'review',reason:'同日に複数校舎の授業があります。'}]}});
 });
 await page.goto('/staff/interviews');await page.getByRole('button',{name:'受付日程'}).click();await page.getByRole('button',{name:'予約可を確認'}).click();
 const preview=page.locator('[aria-label="予約可の反映予定"]');await expect(preview).toContainText('作成 1');await expect(preview).toContainText('要確認 1');await expect(preview).toContainText('2026-10-04 14:00〜14:45');expect(posts).toBe(0);
 await page.getByRole('button',{name:'この内容をNotionへ反映'}).click();const dialog=page.getByRole('dialog',{name:'予約可の反映確認'});await expect(dialog).toContainText('作成 1件');await dialog.getByRole('button',{name:'Notionへ反映する'}).click();
 await expect(page.getByRole('status')).toContainText('1件をNotionへ反映しました');expect(posts).toBe(1);await expect(preview).toContainText('変更なし 1');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('金城の画面には工藤の自動作成ボタンを表示しない',async({page})=>{
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000002',staffCode:'KINJO',displayName:'金城正樹',role:'admin'}}}));
 await page.route('**/api/staff/interview-requests**',route=>route.fulfill({json:state}));await page.goto('/staff/interviews');await expect(page.getByRole('button',{name:'受付日程'})).toHaveCount(0);
});
