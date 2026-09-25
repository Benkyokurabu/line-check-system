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
