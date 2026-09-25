import {test,expect} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

test('予約枠の設計図を390pxで表示し、区切り方を切り替えられる',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(pathToFileURL(resolve('docs/interview-slot-options-20260925.html')).href);
 await expect(page.getByRole('heading',{name:'先生ごとに選べる予約可能枠の作り方'})).toBeVisible();
 await expect(page.locator('#result')).toContainText('2枠');
 await page.getByRole('button',{name:'15分の余裕を入れる'}).click();
 await expect(page.locator('#result')).toContainText('1枠');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('金城先生専用の60分・50分枠と授業条件を表示する',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(pathToFileURL(resolve('docs/kinjo-interview-slots-20260925.html')).href);
 await expect(page.getByRole('heading',{name:'金城先生専用の面談予約可能枠'})).toBeVisible();
 await expect(page.locator('#summary')).toContainText('11枠');
 await expect(page.getByText('⑪ 22:05〜終了未定')).toBeVisible();
 await expect(page.getByText('授業の有無に関係なく候補')).toBeVisible();
 await page.getByRole('checkbox',{name:'20:25〜21:55の授業あり'}).check();
 await expect(page.locator('#summary')).toContainText('9枠');
 await expect(page.getByText('⑪ 22:05〜終了未定')).toBeVisible();
 await page.getByRole('checkbox',{name:'14:55〜16:25の授業あり'}).check();
 await expect(page.locator('#summary')).toContainText('7枠');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
