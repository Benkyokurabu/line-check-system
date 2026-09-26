import {test,expect} from '@playwright/test';
const ids=['11111111111141118111111111111111','22222222222242228222222222222222','33333333333343338333333333333333'];
const students=ids.map((id,i)=>({grade:'中3',name:`日程確認${i+1}`,notionUrl:`https://app.notion.com/p/${id}`,submittedAt:'2026-09-23'}));
test('回答確認から面談終了までを一つの進捗として表示・絞り込みする',async({page})=>{
 let failed=false,answered=false;
 await page.route('**/api/interview-surveys',r=>r.fulfill({json:{groups:[{teacher:'工藤',students}]}}));
 await page.route('**/api/interview-surveys/confirmations',r=>r.fulfill({json:{states:[{page_id:ids[0],confirmed:true,version:1}]}}));
 await page.route('**/api/interview-surveys/scheduling',r=>failed?r.fulfill({status:503,json:{error:'unavailable'}}):r.fulfill({json:{states:{[ids[0]]:{status:'uncontacted',detail:'日程の打診はまだありません。'},[ids[1]]:{status:'invited',detail:answered?'返信あり・先生の承認待ち':'返信待ち'},[ids[2]]:{status:'confirmed',detail:'日程が確定しています。',date:'2026-09-30',start:'16:00',end:'16:45'}},updatedAt:'2026-09-23T12:00:00Z'}}));
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');
 const list=page.getByRole('list',{name:'工藤先生のアンケート回答'});
 const handled=list.getByRole('listitem').filter({hasText:'日程確認1'});const progress=handled.getByRole('combobox',{name:'日程確認1の対応状況'});await expect(progress).toHaveValue('handled');await expect(progress.locator('option')).toHaveText(['要確認','対応済み','日程調整中','日程確定','面談終了']);await expect(handled.getByRole('link',{name:'日程確認1：資料をつくる'})).toHaveAttribute('href',`/staff/interview-materials?answer=${ids[0]}`);await expect(handled.getByRole('link',{name:/面談日程を案内|日程を案内/})).toHaveCount(0);
 await expect(list.getByRole('combobox',{name:'日程確認2の対応状況'})).toHaveValue('coordinating');await expect(list.getByRole('combobox',{name:'日程確認3の対応状況'})).toHaveValue('scheduled');await expect(list.getByText('2026-09-30 16:00〜16:45')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'analysis_outputs/survey-scheduling-mobile.png',fullPage:true});
 await page.getByRole('combobox',{name:'アンケートの進捗',exact:true}).selectOption('coordinating');await expect(list.getByRole('listitem')).toHaveCount(1);
 answered=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(list.getByText('返信あり・先生の承認待ち')).toBeVisible();
 failed=true;await page.getByRole('button',{name:'一覧を最新に更新',exact:true}).click();await expect(page.getByText('日程状況を取得できません。再取得してください。',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'アンケートの進捗',exact:true}).selectOption('');await expect(list.locator('[data-status="needs-review"]')).toHaveCount(2);await expect(list.locator('[data-status="handled"]')).toHaveCount(1);await expect(list.getByText('未連絡',{exact:true})).toHaveCount(0);
});
test('日程状況APIは未ログインのアクセスを拒否する',async({request})=>{
 expect((await request.get('/api/interview-surveys/scheduling')).status()).toBe(401);
});
