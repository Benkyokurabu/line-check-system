import {test,expect} from '@playwright/test';
import {defaults} from '../../src/lib/interview-core.mjs';
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
const fixture=()=>({snapshot:'snapshot',students:[{id:'00000000-0000-4000-8000-000000000001',student_name:'架空生徒',student_number:'test01',grade:'中1',campus:'本校',homeroom_teacher:'架空講師'}],teachers:['架空講師'],lessons:[{id:'lesson',lesson_date:today,start_time:'16:45～18:15',teacher_name:'架空講師',campus:'本校',classroom:'1'}],bookings:[],slots:[],settings:{data:defaults,notion_status:'未接続'},canEdit:true});
test('生徒を選ぶと担任・校舎を補完し、確認後だけ保存する',async({page})=>{
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'staff',displayName:'架空職員',role:'admin'}}}));
 const operations:Record<string,unknown>[]=[];
 await page.route('**/api/staff/interviews',async route=>{if(route.request().method()==='POST'){operations.push(route.request().postDataJSON());await route.fulfill({json:{saved:{}}});}else await route.fulfill({json:fixture()});});
 await page.goto('/staff/interviews');
 await expect(page.getByRole('heading',{name:'予約可',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'この時刻で入力'}).first().click();
 const dialog=page.getByRole('dialog',{name:'面談予定の入力'});
 await dialog.getByRole('combobox',{name:/^生徒/}).selectOption('00000000-0000-4000-8000-000000000001');
 await expect(dialog.getByRole('combobox',{name:/^担当講師/})).toHaveValue('架空講師');
 await dialog.getByRole('button',{name:'内容を確認'}).click();expect(operations).toHaveLength(0);
 await page.getByRole('dialog',{name:'保存前の確認'}).getByRole('button',{name:'保存する'}).click();
 await expect(page.getByRole('status')).toContainText('保存しました');expect(operations).toHaveLength(1);expect(operations[0].action).toBe('create');
});
test('ログインしていない状態で生徒情報を表示しない',async({page})=>{
 await page.route('**/api/staff/session',route=>route.fulfill({status:401,json:{error:'ログインしてください。'}}));
 await page.goto('/staff/interviews');await expect(page.getByRole('heading',{name:'職員ログイン'})).toBeVisible();await expect(page.getByText('架空生徒')).toHaveCount(0);
});
test('一般講師には承認・設定変更の操作を表示しない',async({page})=>{
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'staff',displayName:'架空講師',role:'teacher'}}}));
 await page.route('**/api/staff/interviews',route=>route.fulfill({json:{...fixture(),canEdit:false}}));
 await page.goto('/staff/interviews');await expect(page.getByRole('heading',{name:'予約可',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'面談を登録',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'予約枠の設定'})).toHaveCount(0);
});
test('スマートフォンの入力画面は横にはみ出さない',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'staff',displayName:'架空職員',role:'admin'}}}));
 await page.route('**/api/staff/interviews',route=>route.fulfill({json:fixture()}));
 await page.goto('/staff/interviews');await page.getByRole('button',{name:'面談を登録',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await expect(page.getByRole('dialog',{name:'面談予定の入力'})).toBeVisible();
});
