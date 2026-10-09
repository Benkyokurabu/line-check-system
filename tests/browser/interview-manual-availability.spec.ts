import {test,expect} from '@playwright/test';

for(const end of ['14:45',''])test(`先生がNotionの予約可を選び、確認して削除する（${end?'終了時刻あり':'開始時刻のみ'}）`,async({page})=>{
 const slot={pageId:'00000000-0000-4000-8000-000000000011',editedAt:'2026-09-25T00:00:00Z',date:'2026-10-02',start:'14:00',end,campus:'本校',teacher:'工藤'};
 const operations:Record<string,unknown>[]=[];let archived=false,reads=0;
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000001',staffCode:'KUDO',displayName:'工藤謙',role:'admin'}}}));
 await page.route('**/api/staff/interview-availability-copy*',route=>route.fulfill({json:{teachers:[{id:'00000000-0000-4000-8000-000000000001',name:'工藤先生'}],defaultTeacherId:'00000000-0000-4000-8000-000000000001'}}));
 await page.route('**/api/staff/interview-manual-availability*',route=>{
  if(route.request().method()==='POST'){
   const operation=route.request().postDataJSON();operations.push(operation);archived=true;return route.fulfill({json:{saved:{pageId:slot.pageId,archived:true}}});
  }
  reads++;return route.fulfill({json:{teacher:'工藤',rows:archived?[]:[slot]}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/staff/interview-availability/manual');
 const entry=page.getByRole('link',{name:'予約可を削除',exact:true});
 await expect(entry).toBeVisible();await expect(entry).toHaveAttribute('href','/staff/interview-availability/manual/delete');
 await expect(page.getByLabel('対象月')).toHaveCount(0);await expect(page.getByRole('button',{name:'この枠をNotionから削除'})).toHaveCount(0);expect(reads).toBe(0);
 await page.screenshot({path:`test-results/availability-delete-entry-${end?'timed':'open'}.png`,fullPage:true});
 await entry.click();await expect(page).toHaveURL(/\/staff\/interview-availability\/manual\/delete$/);await expect(page.getByRole('heading',{level:1,name:'予約可を削除',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'予約可能枠をコピー'})).toHaveCount(0);
 const time=`14:00${end?`〜${end}`:''}`;
 await expect(page.getByText(`2026-10-02 ${time}`,{exact:true})).toBeVisible();
 await expect(page.locator('main')).not.toContainText('終了時刻なし');
 await page.screenshot({path:`test-results/availability-delete-list-${end?'timed':'open'}.png`,fullPage:true});
 await page.getByRole('button',{name:'この枠をNotionから削除'}).click();
 expect(operations).toHaveLength(0);
 const dialog=page.getByRole('dialog',{name:'Notionの予約可を削除'});
 await expect(dialog).toContainText(time);
 await expect(dialog).not.toContainText('終了時刻なし');
 await dialog.getByRole('button',{name:'Notionから削除する'}).click();
 await expect(page.getByRole('status')).toContainText('Notionから削除しました');
 await expect(page.getByText('この月の予約可はありません。')).toBeVisible();
 expect(operations[0]).toMatchObject({action:'archive',pageId:slot.pageId,editedAt:slot.editedAt});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('link',{name:'← 予約可能枠をコピーする画面へ'}).click();await expect(entry).toBeVisible();await expect(page.getByLabel('対象月')).toHaveCount(0);
});
