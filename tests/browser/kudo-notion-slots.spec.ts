import {test,expect} from '@playwright/test';

const studentId='00000000-0000-4000-8000-000000000001';
const kudoOffers=[
 {pageId:'00000000-0000-4000-8000-000000000011',date:'2030-01-02',start:'13:00',end:'13:45',teacher:'工藤'},
 {pageId:'00000000-0000-4000-8000-000000000012',date:'2030-01-03',start:'14:00',end:'14:45',teacher:'工藤先生'},
];

test('担任別のNotion予約可を自動表示し、公開後は生徒ごとに担任の枠を選べる',async({page})=>{
 let published=false;const operations:Record<string,unknown>[]=[];
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'staff',staffCode:'KUDO',displayName:'工藤謙',role:'admin'}}}));
 await page.route('**/api/staff/interview-requests**',route=>{
  const url=new URL(route.request().url());
  if(route.request().method()==='POST'){
   const operation=route.request().postDataJSON();operations.push(operation);published=operation.action==='publish';return route.fulfill({json:{saved:{published}}});
  }
  if(url.searchParams.get('offers')==='1')return route.fulfill({json:{offers:[...kudoOffers,{pageId:'00000000-0000-4000-8000-000000000013',date:'2030-01-04',start:'15:00',end:'15:45',teacher:'金城'}]}});
  return route.fulfill({json:{snapshot:'snapshot',requests:[],bookings:[],slots:published?[{id:'00000000-0000-4000-8000-000000000021',notion_page_id:kudoOffers[0].pageId,published:true,data:{...kudoOffers[0]}}]:[],loginReady:true}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/staff/interviews');await page.getByRole('button',{name:'受付日程'}).click();
 await expect(page.getByRole('heading',{name:'担任別のNotion予約可'})).toBeVisible();
 await expect(page.getByRole('button',{name:'保護者に表示'})).toHaveCount(3);await expect(page.getByText('金城先生')).toBeVisible();
 await page.getByRole('button',{name:'保護者に表示'}).first().click();const dialog=page.getByRole('dialog',{name:'保護者に公開する日程'});await dialog.getByRole('button',{name:'この内容で保存'}).click();
 await expect(page.getByRole('heading',{name:'保護者に表示中'})).toBeVisible();await expect(page.getByRole('button',{name:'保護者への表示を停止'})).toBeVisible();
 expect(operations).toHaveLength(1);expect(operations[0]).toMatchObject({action:'publish',pageId:kudoOffers[0].pageId});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

 await page.route('**/api/parent/interviews',route=>route.fulfill({json:{students:[{id:studentId,name:'確認用生徒'}],slots:[{id:'00000000-0000-4000-8000-000000000021',studentId,date:kudoOffers[0].date,start:kudoOffers[0].start,end:kudoOffers[0].end}],requests:[]}}));
 await page.goto('/interviews');const choice=page.locator('button[aria-pressed]').first();await expect(choice).toContainText('13:00〜13:45');await choice.click();await expect(choice).toContainText('第1希望');
});
