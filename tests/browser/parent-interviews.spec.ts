import {test,expect,type Page} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000001';
const slots=[0,1,2,3].map((n)=>({id:`00000000-0000-4000-8000-00000000000${n+2}`,studentId:id,date:'2030-01-0'+(n+2),start:'13:00',end:'13:45'}));
async function parent(page:Page,{lost=false}={}){
 const operations:Record<string,unknown>[]=[];let saved=false;
 await page.route('**/api/parent/interviews',route=>{
  if(route.request().method()==='POST'){const op=route.request().postDataJSON();operations.push(op);saved=true;if(lost&&operations.length===1)return route.abort();return route.fulfill({json:{saved:true}});}
  return route.fulfill({json:{students:[{id,name:'確認用生徒'}],slots,requests:saved?[{id:'request',studentId:id,status:'pending',version:1,choices:[{...slots[0],slotId:slots[0].id}],note:'',reason:'',confirmed:null}]:[]}});
 });
 await page.goto('/interviews');return operations;
}
test('保護者は一覧から第3希望まで選び、順序変更・戻るで内容を保持して送信する',async({page})=>{
 const operations=await parent(page);await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('navigation',{name:'業務ナビゲーション'})).toHaveCount(0);
 await expect(page.getByRole('combobox')).toHaveCount(0);await expect(page.getByLabel('面談方法')).toHaveCount(0);
 for(let i=0;i<3;i++)await page.locator('button[aria-pressed]').nth(i).click();
 await expect(page.locator('button[aria-pressed]').nth(3)).toBeDisabled();
 await page.getByRole('button',{name:'優先順を上げる'}).last().click();
 await page.getByText('相談したいことを記入する（任意）').click();await page.getByLabel('相談内容').fill('学習の相談');
 await page.getByRole('button',{name:'選んだ日程を確認する'}).click();const dialog=page.getByRole('dialog',{name:'予約希望の確認'});
 await dialog.getByRole('button',{name:'← 戻る'}).click();await expect(page.getByLabel('相談内容')).toHaveValue('学習の相談');
 await page.getByRole('button',{name:'選んだ日程を確認する'}).click();await dialog.getByRole('button',{name:'予約希望を送信する'}).click();
 await expect(page.getByText('承認待ち',{exact:true})).toBeVisible();expect(operations).toHaveLength(1);expect(operations[0].choices).toEqual([slots[0].id,slots[2].id,slots[1].id]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'analysis_outputs/parent-interviews/parent-submitted.png',fullPage:true});
});
test('保護者の通信結果不明時は編集を止め、同じ申請で再確認する',async({page})=>{
 const operations=await parent(page,{lost:true});await page.locator('button[aria-pressed]').first().click();await page.getByRole('button',{name:'選んだ日程を確認する'}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'予約希望を送信する'}).click();await expect(dialog.getByRole('button',{name:'← 戻る'})).toBeDisabled();
 await dialog.getByRole('button',{name:'送信結果を再確認する'}).click();await expect(page.getByText('承認待ち',{exact:true})).toBeVisible();expect(operations).toHaveLength(2);expect(operations[0]).toEqual(operations[1]);
});
test('LINE未設定・未紐づけでは個人情報や日程申請を表示しない',async({page})=>{
 await page.route('**/api/parent/interviews',r=>r.fulfill({status:401,json:{loginRequired:true,loginAvailable:false}}));await page.goto('/interviews');await expect(page.getByText(/受付は準備中/)).toBeVisible();await expect(page.getByRole('link',{name:'LINEで続ける'})).toHaveCount(0);
 await page.route('**/api/parent/interviews',r=>r.fulfill({json:{students:[],slots:[],requests:[]}}));await page.reload();await expect(page.getByText(/お子さまとの登録を確認できませんでした/)).toBeVisible();await expect(page.getByRole('button',{name:'選んだ日程を確認する'})).toHaveCount(0);
});
test('先生は第2希望を選び、確認から戻ってから承認しNotion結果を見る',async({page})=>{
 let approved=false;const operations:Record<string,unknown>[]=[];
 await page.route('**/api/staff/session',r=>r.fulfill({json:{staff:{staffId:'staff',staffCode:'KUDO',displayName:'確認用講師',role:'admin'}}}));
 await page.route('**/api/staff/interview-requests',route=>{
  if(route.request().method()==='POST'){operations.push(route.request().postDataJSON());approved=true;return route.fulfill({json:{saved:{},sync:{status:'synced',message:'Notionに反映しました。'}}});}
  return route.fulfill({json:{requests:approved?[]:[{id:'request',studentName:'確認用生徒',status:'pending',version:1,note:'学習の相談',choices:slots.slice(0,3).map(s=>({slotId:s.id,data:{...s,teacher:'確認用講師'},available:true}))}],bookings:approved?[{id:'booking',status:'confirmed',version:2,notion_synced_version:2,notion_page_id:'test',data:{...slots[1],teacher:'確認用講師',studentName:'確認用生徒',method:'Zoom'}}]:[],slots:[],loginReady:true}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/staff/interviews');
 const manage=page.getByRole('link',{name:'面談記録・取消・詳細管理'});
 await expect(manage).toBeVisible();await expect(manage).toHaveCSS('min-height','44px');await expect(manage).toHaveCSS('background-color','rgb(23, 125, 99)');
 await page.getByRole('radio').nth(1).check();await page.getByRole('button',{name:'選んだ日程で承認'}).click();let dialog=page.getByRole('dialog',{name:'日程を承認'});
 await dialog.getByRole('button',{name:'← 戻る'}).click();await expect(page.getByRole('radio').nth(1)).toBeChecked();expect(operations).toHaveLength(0);
 await page.getByRole('button',{name:'選んだ日程で承認'}).click();dialog=page.getByRole('dialog',{name:'日程を承認'});await dialog.getByRole('button',{name:'承認する',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Notionに反映しました');expect(operations[0].slotId).toBe(slots[1].id);await page.getByRole('button',{name:'確定予定',exact:true}).click();
 await expect(page.getByText('Notion反映済み')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'analysis_outputs/parent-interviews/teacher-confirmed.png',fullPage:true});
});
test('保護者APIは未認証・別originの変更を拒否する',async({request})=>{
 const read=await request.get('/api/parent/interviews');expect(read.status()).toBe(401);expect(await read.json()).toEqual({loginRequired:true,loginAvailable:false});
 const denied=await request.post('/api/parent/interviews',{headers:{origin:'https://other.invalid'},data:{action:'submit'}});expect(denied.status()).toBe(403);
});

test('終了すると保護者の氏名と申請を画面から消す',async({page})=>{
 await parent(page);
 let ended=false;
 await page.route('**/api/parent/interviews',async(route)=>{
  if(route.request().method()==='DELETE'){ended=true;return route.fulfill({json:{loggedOut:true}});}
  return route.fallback();
 });
 await expect(page.getByRole('heading',{name:'確認用生徒さんの面談'})).toBeVisible();
 await page.getByRole('button',{name:'終了する',exact:true}).click();
 expect(ended).toBe(true);
 await expect(page.getByRole('heading',{name:'確認用生徒さんの面談'})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'LINEで続ける'})).toBeVisible();
});
