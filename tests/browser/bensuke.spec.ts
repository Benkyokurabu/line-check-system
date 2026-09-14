import {test,expect} from '@playwright/test';
import {defaults} from '../../src/lib/interview-core.mjs';
test('スマホで既存予定を読み、日付変更や通信失敗で古い結果を残さない',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'staff',staffCode:'KUDO',displayName:'検証職員',role:'admin'}}}));
 await page.route('**/api/staff/interviews',route=>route.fulfill({json:{snapshot:'s',students:[],teachers:['担当者'],lessons:[],bookings:[],slots:[],settings:{data:defaults,notion_status:'未接続'},canEdit:true}}));
 let failure=false;let reads=0;
 await page.route('**/api/staff/interviews/bensuke?*',route=>{
  reads++;const date=new URL(route.request().url()).searchParams.get('date');
  return route.fulfill(failure?{status:503,json:{error:'ベンスケを読み取れません。'}}:{json:{date,checkedAt:new Date().toISOString(),rows:[{id:'one',title:'Notionの既存予定',url:'https://www.notion.so/11111111111111111111111111111111',date:{start:`${date}T13:00:00+09:00`,end:null},fields:[{name:'担当者',value:'講師A'}]}]}});
 });
 await page.goto('/staff/interviews');
 await page.getByRole('button',{name:'ベンスケから予定を取得'}).click();
 await expect(page.getByRole('link',{name:'Notionの既存予定'})).toBeVisible();expect(reads).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByLabel('日付',{exact:true}).fill('2026-12-01');
 await expect(page.getByRole('link',{name:'Notionの既存予定'})).toHaveCount(0);
 failure=true;await page.getByRole('button',{name:'ベンスケから予定を取得'}).click();
 await expect(page.getByRole('alert').filter({hasText:'ベンスケを読み取れません。'})).toBeVisible();
 await expect(page.getByText('この日に開始する予定はありません。')).toHaveCount(0);
});
test('未認証のベンスケAPIは取得を許可しない',async({request})=>{
 const response=await request.get('/api/staff/interviews/bensuke?date=2026-09-14');
 expect(response.status()).toBe(401);
});
