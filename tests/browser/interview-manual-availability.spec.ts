import {test,expect} from '@playwright/test';

test('先生がNotionの予約可を選び、確認して削除する',async({page})=>{
 const slot={pageId:'00000000-0000-4000-8000-000000000011',editedAt:'2026-09-25T00:00:00Z',date:'2026-10-02',start:'14:00',end:'14:45',campus:'本校',teacher:'工藤'};
 const operations:Record<string,unknown>[]=[];let archived=false;
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000001',staffCode:'KUDO',displayName:'工藤謙',role:'admin'}}}));
 await page.route('**/api/staff/interview-manual-availability*',route=>{
  if(route.request().method()==='POST'){
   const operation=route.request().postDataJSON();operations.push(operation);archived=true;return route.fulfill({json:{saved:{pageId:slot.pageId,archived:true}}});
  }
  return route.fulfill({json:{teacher:'工藤',rows:archived?[]:[slot]}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/staff/interview-availability/manual');
 await expect(page.getByText('2026-10-02 14:00〜14:45')).toBeVisible();
 await page.getByRole('button',{name:'この枠をNotionから削除'}).click();
 expect(operations).toHaveLength(0);
 const dialog=page.getByRole('dialog',{name:'Notionの予約可を削除'});
 await expect(dialog).toContainText('14:00〜14:45');
 await dialog.getByRole('button',{name:'Notionから削除する'}).click();
 await expect(page.getByRole('status')).toContainText('Notionから削除しました');
 await expect(page.getByText('この月の予約可はありません。')).toBeVisible();
 expect(operations[0]).toMatchObject({action:'archive',pageId:slot.pageId,editedAt:slot.editedAt});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
