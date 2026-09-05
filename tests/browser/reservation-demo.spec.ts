import { expect,test } from '@playwright/test';

test('student demo covers unavailable seats, request, staff approval and cancellation without any API',async ({page})=>{
  const apiCalls:string[]=[];
  await page.context().route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/')) {apiCalls.push(url.pathname);await route.abort();}
    else if(url.origin!=='http://127.0.0.1:3197') await route.abort();
    else await route.continue();
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('/self-study-room/menu-preview');
  await expect(page.getByRole('link',{name:'トップページへ'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'申請内容を確認する'})).toBeDisabled();
  await page.getByRole('button',{name:/20:25–21:55/}).click();
  await expect(page.getByRole('status')).toContainText('満席');
  await expect(page.getByRole('button',{name:'1番席 予約済み',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:/14:55–16:25/}).click();
  await page.getByRole('button',{name:'1番席',exact:true}).click();
  await page.getByRole('button',{name:'申請内容を確認する'}).click();
  await expect(page.getByRole('heading',{name:'この内容で申請しますか？'})).toBeVisible();
  await page.getByRole('button',{name:'この内容で申請する（デモ）'}).click();
  await expect(page.getByRole('status')).toContainText('承認待ち');
  await page.getByText('デモの続きを見る：職員の承認を再現').click();
  await page.getByRole('button',{name:'職員が承認した状態に進む'}).click();
  await expect(page.getByRole('status')).toHaveText('予約が確定しました');
  await page.screenshot({path:'test-results/reservation-demo-confirmed.png',fullPage:true});
  await page.getByRole('button',{name:'キャンセルの流れを試す'}).click();
  await page.getByRole('button',{name:'取りやめる（デモ）'}).click();
  await expect(page.getByRole('status')).toHaveText('取りやめを受け付けました');
  await page.getByRole('button',{name:'最初から試す'}).click();
  await expect(page.getByRole('button',{name:'申請内容を確認する'})).toBeDisabled();
  expect(apiCalls).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
