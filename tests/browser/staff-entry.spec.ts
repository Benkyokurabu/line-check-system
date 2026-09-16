import {test,expect} from '@playwright/test';
test('アプリ更新の再読み込みが専用入口の認証を中断しない',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let calls=0;
 await page.route('**/api/staff/entry',async r=>{calls++;await gate;await r.fulfill({json:{destination:'/staff/interviews?staff=KUDO'}});});
 await page.route('**/api/staff/session',r=>r.fulfill({status:401,json:{error:'ログインしてください'}}));
 await page.goto('http://localhost:3197/staff/entry#key='+ 'x'.repeat(43));
 await expect.poll(()=>calls).toBe(1);
 await page.evaluate(()=>navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
 release();
 await expect(page).toHaveURL(/\/staff\/interviews\?staff=KUDO$/);expect(calls).toBe(1);
});
test('専用入口はパスワードを求めず、キーをURLから除去して内部画面へ進む',async({page})=>{
 const key='x'.repeat(43);let calls=0;
 await page.route('**/api/staff/entry',async r=>{calls++;expect(r.request().postDataJSON()).toEqual({key,destination:'interviews'});expect(page.url()).not.toContain(key);await r.fulfill({json:{destination:'/staff/interviews?staff=KUDO'}});});
 await page.route('**/api/staff/session',r=>r.fulfill({status:401,json:{error:'ログインしてください'}}));
 await page.goto(`/staff/entry#key=${key}&to=interviews`);await expect(page).toHaveURL(/\/staff\/interviews\?staff=KUDO$/);expect(calls).toBe(1);
});
test('専用キーなし・接続失敗で名前だけのログインを行わない',async({page})=>{
 let calls=0;await page.route('**/api/staff/entry',r=>{calls++;return r.fulfill({status:401,json:{error:'invalid'}});});
 await page.goto('/staff/entry?staff=KUDO');await expect(page.locator('p[role="alert"]')).toContainText('LINEの個別メニュー');expect(calls).toBe(0);
 await page.goto('about:blank');
 await page.goto('/staff/entry#key='+ 'x'.repeat(43));await expect(page.locator('p[role="alert"]')).toContainText('開き直してください');
 await expect(page.getByLabel('パスワード')).toHaveCount(0);
});
test('専用入口APIの他サイトからの利用と名前だけの利用を拒否',async({request})=>{
 const foreign=await request.post('/api/staff/entry',{headers:{origin:'https://evil.invalid'},data:{key:'x'.repeat(43)}});expect(foreign.status()).toBe(403);
 const noKey=await request.post('/api/staff/entry',{headers:{origin:'https://test.invalid'},data:{staffCode:'KUDO'}});expect(noKey.status()).toBe(401);
});
