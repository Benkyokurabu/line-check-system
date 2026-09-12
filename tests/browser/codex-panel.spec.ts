import { test, expect } from '@playwright/test';
test('owner can select a page element, send context, and keep conversation after navigation',async({page})=>{
  const jobs: Record<string,unknown>[]=[];
  let posted: Record<string,unknown> | undefined;
  await page.route('**/api/codex*',async route=>{
    if(route.request().method()==='POST') {
      posted=route.request().postDataJSON();
      jobs.push({id:posted!.id,message:posted!.message,page_context:posted!.context,status:'completed',response:'選択箇所を確認しました。',progress:'回答済み'});
      await route.fulfill({json:{accepted:true}});
    } else await route.fulfill({json:{authorized:true,online:true,requests:jobs}});
  });
  await page.goto('/feedback');
  await page.getByRole('button',{name:'✦ Codexに修正を依頼'}).click();
  await page.getByRole('button',{name:'⌖ 場所を選ぶ'}).click();
  const target=page.locator('h1').first();
  const heading=await target.innerText();await target.click();
  await page.getByLabel('修正したい内容・質問').fill('見出しを大きくしてください');
  await page.locator('[data-codex-panel]').getByRole('button',{name:'送信',exact:true}).click();
  await expect(page.getByText('選択箇所を確認しました。')).toBeVisible();
  expect(posted?.context).toMatchObject({path:'/feedback',selection:heading});
  const conversation=posted?.conversationId;
  await page.goto('/');
  await page.getByRole('button',{name:'✦ Codexに修正を依頼'}).click();
  await expect(page.getByText('選択箇所を確認しました。')).toBeVisible();
  expect(await page.getByLabel('会話を切り替え').inputValue()).toBe(conversation);
  await page.screenshot({path:'analysis_outputs/codex-panel/desktop.png',fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByLabel('修正したい内容・質問')).toBeVisible();
  const box=await page.getByRole('complementary',{name:'Codexに修正を依頼'}).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:'analysis_outputs/codex-panel/mobile.png',fullPage:false});
});
test('unauthenticated users cannot see the panel',async({page})=>{
  await page.route('**/api/codex*',route=>route.fulfill({status:403,json:{error:'権限がありません'}}));
  await page.goto('/feedback');
  await expect(page.getByRole('button',{name:'✦ Codexに修正を依頼'})).toHaveCount(0);
});
