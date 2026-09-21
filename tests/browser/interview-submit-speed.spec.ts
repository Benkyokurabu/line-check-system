import {test,expect} from '@playwright/test';
for(const live of [false,true])test(`保存応答から承認待ちを表示し、空き枠の再取得を待たない ${live}`,async({page})=>{
 const endpoint=live?'/api/staff/interview-live-preview':'/api/parent/interviews';let reads=0,writes=0;
 const slot={id:'slot',studentId:'student',date:'2030-01-02',start:'13:00',end:'13:45'};
 await page.route('**/api/**',route=>{
  if(new URL(route.request().url()).pathname!==endpoint)return route.fulfill({json:{}});
  if(route.request().method()==='POST'){
   writes++;return route.fulfill({json:{saved:true,request:{id:'request',studentId:'student',status:'pending',version:1,choices:[{...slot,slotId:'slot'}],note:'',reason:'',confirmed:null}}});
  }
  reads++;if(reads>1)return route.abort();
  return route.fulfill({json:{students:[{id:'student',name:'確認用生徒',teacher:'工藤'}],slots:[slot],requests:[]}});
 });
 await page.goto(live?'/interviews/trial':'/interviews');await page.getByRole('button',{name:/1月2日/}).click();
 await page.getByRole('button',{name:'選んだ日程を確認する'}).click();
 await page.getByRole('button',{name:'予約希望を送信する'}).click();
 await expect(page.getByText('承認待ち',{exact:true})).toBeVisible();
 await expect(page.getByRole('status')).toContainText('送信しました');
 await expect(page.getByRole('button',{name:'状況を更新する'})).toBeEnabled();
 await expect(page.getByRole('button',{name:'選んだ日程を確認する'})).toHaveCount(0);
 expect(reads).toBe(1);expect(writes).toBe(1);
 await page.getByRole('button',{name:'状況を更新する'}).click();
 await expect(page.getByText('承認待ち',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'送信結果を再確認する'})).toHaveCount(0);expect(writes).toBe(1);
});
