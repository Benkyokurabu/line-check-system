import {test,expect} from '@playwright/test';
import {defaults} from '../../src/lib/interview-core.mjs';
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
const fixture=()=>({snapshot:'snapshot',students:[{id:'00000000-0000-4000-8000-000000000001',student_name:'架空生徒',student_number:'test01',grade:'中1',campus:'本校',homeroom_teacher:'架空講師'}],teachers:['架空講師'],lessons:[{id:'lesson',lesson_date:today,start_time:'16:45～18:15',teacher_name:'架空講師',campus:'本校',classroom:'1'}],bookings:[],slots:[],settings:{data:defaults,notion_status:'未接続'},canEdit:true});
test('生徒を選ぶと担任・校舎を補完し、確認後だけ保存する',async({page})=>{
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'staff',staffCode:'KUDO',displayName:'架空職員',role:'admin'}}}));
 const operations:Record<string,unknown>[]=[];
 await page.route('**/api/staff/interviews',async route=>{if(route.request().method()==='POST'){operations.push(route.request().postDataJSON());await route.fulfill({json:{saved:{}}});}else await route.fulfill({json:fixture()});});
 await page.goto('/staff/interviews/manage');
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
 await page.goto('/staff/interviews/manage');await expect(page.getByLabel('パスワード')).toBeVisible();await expect(page.getByText('架空生徒')).toHaveCount(0);
});
test('一般講師には承認・設定変更の操作を表示しない',async({page})=>{
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'staff',staffCode:'KUDO',displayName:'架空講師',role:'teacher'}}}));
 await page.route('**/api/staff/interviews',route=>route.fulfill({json:{...fixture(),canEdit:false}}));
 await page.goto('/staff/interviews/manage');await expect(page.getByRole('heading',{name:'予約可',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'面談を登録',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'予約枠の設定'})).toHaveCount(0);
});
test('スマートフォンの入力画面は横にはみ出さない',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'staff',staffCode:'KUDO',displayName:'架空職員',role:'admin'}}}));
 await page.route('**/api/staff/interviews',route=>route.fulfill({json:fixture()}));
 await page.goto('/staff/interviews/manage');await page.getByRole('button',{name:'面談を登録',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await expect(page.getByRole('dialog',{name:'面談予定の入力'})).toBeVisible();
});

test('面談記録に予定を補完し、実績と決定事項を保存・再表示する',async({page})=>{
 const booking={id:'booking',status:'confirmed',version:1,notion_page_id:null,notion_synced_version:0,sync_error:null,data:{studentId:'00000000-0000-4000-8000-000000000001',studentName:'架空生徒',studentNumber:'test01',grade:'中1',teacher:'架空講師',date:today,start:'13:00',end:'13:45',campus:'本校',method:'対面',purpose:'学習相談',participants:'本人、母',channel:'職員入力',note:'',room:'',record:undefined as Record<string,unknown>|undefined}};
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'staff',staffCode:'KUDO',displayName:'架空職員',role:'admin'}}}));
 await page.route('**/api/staff/interviews',async route=>{
  if(route.request().method()==='POST'){const op=route.request().postDataJSON();booking.data.record=op.data;booking.status='completed';booking.version++;await route.fulfill({json:{saved:booking}});}
  else await route.fulfill({json:{...fixture(),bookings:[booking]}});
 });
 await page.goto('/staff/interviews/manage');await page.getByRole('button',{name:'実施済み・記録入力'}).click();
 const dialog=page.getByRole('dialog',{name:'面談記録',exact:true});
 await expect(dialog.getByLabel('実際の参加者')).toHaveValue('本人、母');
 await expect(dialog.getByLabel('実際の終了時刻')).toHaveValue('13:45');
 await dialog.getByLabel('実際の開始時刻').fill('13:05');await dialog.getByLabel('面談内容',{exact:true}).fill('授業の進み方を相談');
 await dialog.getByLabel('決定事項').fill('毎日10分復習');await dialog.getByLabel('職員が対応すること').fill('教材を用意');
 await dialog.getByRole('button',{name:'下書き保存'}).click();await page.getByRole('dialog',{name:'保存前の確認'}).getByRole('button',{name:'保存する'}).click();
 await page.getByRole('button',{name:'面談記録を編集'}).click();
 await expect(dialog.getByLabel('決定事項')).toHaveValue('毎日10分復習');await expect(dialog.getByLabel('実際の開始時刻')).toHaveValue('13:05');
 expect(booking.data.start).toBe('13:00');expect(booking.data.record?.staffTasks).toBe('教材を用意');
});

test('生徒のスマートフォン画面には面談の入口・予定を表示しない',async({page})=>{
 await page.setViewportSize({width:390,height:844});let interviewRequests=0;
 page.on('request',request=>{if(request.url().includes('/api/staff/interviews'))interviewRequests++;});
 await page.route('**/api/staff/session',route=>route.fulfill({status:401,json:{error:'ログインしてください。'}}));
 await page.goto('/self-study-room/trial');
 await expect(page.locator('a[href="/staff/interviews"]')).toHaveCount(0);
 await expect(page.getByText('面談の予定・入力')).toHaveCount(0);expect(interviewRequests).toBe(0);
});

test('工藤・金城以外は管理者でも面談データを読み込まない',async({page})=>{
 let reads=0;await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'other',staffCode:'OTHER',displayName:'別職員',role:'admin'}}}));
 await page.route('**/api/staff/interviews',route=>{reads++;return route.fulfill({json:fixture()});});
 await page.goto('/staff/interviews?staff=KUDO');
 await expect(page.getByRole('status')).toContainText('工藤さん・金城さん');
 await expect(page.getByRole('heading',{name:'予約可',exact:true})).toHaveCount(0);expect(reads).toBe(0);
});

for(const [staffCode,label] of [['KUDO','工藤さん'],['KINJO','金城正樹さん']])test(`${label}用のスマホ入口はパスワードを必要とする`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({status:401,json:{error:'ログインしてください。'}}));
 await page.goto(`/staff/interviews?staff=${staffCode}`);
 await expect(page.getByText(`${label}用の入口`)).toBeVisible();
 await expect(page.getByLabel('パスワード')).toBeVisible();
 await expect(page.getByRole('heading',{name:'予約可',exact:true})).toHaveCount(0);
});
