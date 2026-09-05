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
  const map = page.getByRole('group',{name:'本校自習室の配置図から座席選択'});
  await expect(map.getByRole('img')).toBeVisible();
  await expect(map.getByRole('button')).toHaveCount(10);
  const first = await map.getByRole('button',{name:'1番席',exact:true}).boundingBox();
  const sixth = await map.getByRole('button',{name:'6番席',exact:true}).boundingBox();
  const eighth = await map.getByRole('button',{name:'8番席',exact:true}).boundingBox();
  expect(first!.y).toBeGreaterThan(sixth!.y);
  expect(eighth!.x).toBeGreaterThan(sixth!.x);
  await expect(page.getByRole('link',{name:'トップページへ'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'申請内容を確認する'})).toBeDisabled();
  await expect(page.getByRole('button',{name:/20:25–21:55/})).toBeDisabled();
  const clearBox=await page.getByRole('button',{name:'選択をクリア',exact:true}).boundingBox();
  const slotBox=await page.getByRole('button',{name:/14:55–16:25/}).boundingBox();
  expect(slotBox!.y-(clearBox!.y+clearBox!.height)).toBeGreaterThanOrEqual(16);
  await expect(page.getByRole('button',{name:'1番席',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:/14:55–16:25/}).click();
  await page.getByRole('button',{name:/18:35–20:05/}).click();
  await expect(page.getByText(/^3コマ選択中/)).toBeVisible();
  await expect(page.getByRole('button',{name:/16:45–18:15/})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'2番席 予約済み',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'5番席 予約済み',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'1番席',exact:true}).click();
  await expect(page.getByText('1番席を選択中')).toBeVisible();
  await page.screenshot({path:'test-results/reservation-demo-seat-map.png',fullPage:true});
  await page.getByRole('button',{name:'申請内容を確認する'}).click();
  await expect(page.getByRole('heading',{name:'この内容で申請しますか？'})).toBeVisible();
  const summary=page.locator('dl[aria-label="予約内容"]');
  await expect(summary.locator('dt')).toHaveText(['生徒名','教室','利用日','座席','時間帯','合計時間','申請する人','申請区分']);
  const rows=await summary.locator(':scope > div').all();
  for(let index=1;index<rows.length;index++) {
    const before=await rows[index-1].boundingBox();
    const after=await rows[index].boundingBox();
    expect(after!.y).toBeGreaterThanOrEqual(before!.y+before!.height);
  }
  await expect(summary.locator('dd').nth(4).locator('div')).toHaveCount(3);
  await expect(page.getByText(/3コマ・270分/)).toBeVisible();
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

test('slot order, repeat clicks, clear and seat availability remain consistent',async ({page})=>{
  await page.goto('/self-study-room/menu-preview');
  const times=[/14:55–16:25/,/16:45–18:15/,/18:35–20:05/];
  for(const order of [[0,1,2],[2,1,0],[0,2],[2,0],[1,0,2],[1,2,0]]) {
    for(const index of order) await page.getByRole('button',{name:times[index]}).click();
    await expect(page.getByText(/^3コマ選択中/)).toBeVisible();
    for(const name of times) await expect(page.getByRole('button',{name})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'1番席',exact:true}).click();
    await page.getByRole('button',{name:times[1]}).click();
    await expect(page.getByText('1番席を選択中')).toBeVisible();
    await expect(page.getByText(/^2コマ選択中/)).toBeVisible();
    await expect(page.getByRole('button',{name:times[1]})).toHaveAttribute('aria-pressed','false');
    await page.getByRole('button',{name:times[1]}).click();
    await expect(page.getByText(/^3コマ選択中/)).toBeVisible();
    await page.getByRole('button',{name:'選択をクリア',exact:true}).click();
    await expect(page.getByRole('button',{name:'申請内容を確認する'})).toBeDisabled();
    await expect(page.getByRole('button',{name:'1番席',exact:true})).toBeDisabled();
  }
  await page.getByRole('button',{name:times[0]}).click();
  await page.getByRole('button',{name:'2番席',exact:true}).click();
  await page.getByRole('button',{name:times[1]}).click();
  await expect(page.getByRole('button',{name:'2番席 予約済み',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'申請内容を確認する'})).toBeDisabled();
  await page.getByRole('button',{name:'空きのある3コマをまとめて選ぶ'}).click();
  await expect(page.getByText(/^3コマ選択中/)).toBeVisible();
  await page.getByRole('button',{name:'選択をクリア',exact:true}).click();
  await page.getByRole('button',{name:times[1]}).click();
  await expect(page.getByText(/^1コマ選択中/)).toBeVisible();
  await page.getByRole('button',{name:times[1]}).click();
  await expect(page.getByRole('button',{name:'選択をクリア',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'申請内容を確認する'})).toBeDisabled();
});

test('nonconsecutive slots control seat availability and summary through submission',async ({page})=>{
  await page.goto('/self-study-room/menu-preview');
  await page.getByRole('button',{name:'空きのある3コマをまとめて選ぶ'}).click();
  await expect(page.getByRole('button',{name:'2番席 予約済み',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:/16:45–18:15/}).click();
  await page.getByRole('button',{name:'2番席',exact:true}).click();
  await page.getByRole('button',{name:'申請内容を確認する'}).click();
  await expect(page.getByText(/2コマ・180分/)).toBeVisible();
  await expect(page.getByText(/16:45–18:15/)).toHaveCount(0);
  await page.getByRole('button',{name:'選び直す',exact:true}).click();
  await expect(page.getByText('2番席を選択中')).toBeVisible();
  await page.getByRole('button',{name:/16:45–18:15/}).click();
  await expect(page.getByRole('button',{name:'申請内容を確認する'})).toBeDisabled();
  await page.getByRole('button',{name:/16:45–18:15/}).click();
  await page.getByRole('button',{name:'2番席',exact:true}).click();
  await page.getByRole('button',{name:'申請内容を確認する'}).click();
  await page.getByRole('button',{name:'この内容で申請する（デモ）'}).click();
  await expect(page.getByRole('status')).toContainText('承認待ち');
  await expect(page.getByText(/2コマ・180分/)).toBeVisible();
  await expect(page.getByText(/16:45–18:15/)).toHaveCount(0);
});

test('date validation, guardian review, back, cancellation back and reset',async ({page})=>{
  await page.goto('/self-study-room/menu-preview');
  await page.getByLabel('申請する人').selectOption('guardian');
  await page.getByLabel('利用するお子さま').selectOption('デモ生徒B');
  await page.getByRole('button',{name:/14:55–16:25/}).click();
  for(const date of ['', '2000-01-01']) {
    await page.getByLabel('利用日').fill(date);
    await page.getByRole('button',{name:'1番席',exact:true}).click();
    await expect(page.getByRole('button',{name:'申請内容を確認する'})).toBeDisabled();
  }
  await page.getByLabel('利用日').fill('2099-01-01');
  await expect(page.getByRole('button',{name:'申請内容を確認する'})).toBeDisabled();
  await page.getByRole('button',{name:'1番席',exact:true}).click();
  await page.getByRole('button',{name:'申請内容を確認する'}).click();
  await expect(page.getByText('デモ生徒B さん')).toBeVisible();
  await page.getByRole('button',{name:'選び直す',exact:true}).click();
  await expect(page.getByText('1番席を選択中')).toBeVisible();
  await page.getByRole('button',{name:'申請内容を確認する'}).click();
  await page.getByRole('button',{name:'この内容で申請する（デモ）'}).click();
  await page.getByRole('button',{name:'キャンセルの流れを試す'}).click();
  await page.getByRole('button',{name:'戻る',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('承認待ち');
  await page.getByRole('button',{name:'最初から試す'}).click();
  await expect(page.getByLabel('申請する人')).toHaveValue('student');
  await expect(page.getByLabel('利用日')).not.toHaveValue('2099-01-01');
  await expect(page.getByRole('button',{name:'選択をクリア',exact:true})).toBeDisabled();
});
