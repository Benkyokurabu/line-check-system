import {test,expect} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000123',token='b'.repeat(64);
const state={students:[{id:'student',name:'確認用生徒',teacher:'工藤'}],slots:[{id:'slot',studentId:'student',date:'2030-01-03',start:'14:00',end:'14:45'}],invitationOnly:true,invitations:[{id,studentId:'student',version:1,expiresAt:'2030-01-02T03:00:00Z'}],requests:[]};
test('未ログインの案内リンクで限定認証し、秘密をURLから消して希望確認まで進める',async({page,context})=>{
 expect(await context.cookies()).toEqual([]);let entered=false,entries=0;
 await page.route('**/api/parent/invitation-entry',async r=>{expect(r.request().postDataJSON()).toEqual({token});entries++;entered=true;await r.fulfill({json:{invitationId:id}})});
 await page.route('**/api/staff/interview-live-preview*',async r=>{expect(entered).toBe(true);expect(new URL(r.request().url()).searchParams.get('invitation')).toBe(id);await r.fulfill({json:state});});
 await page.setViewportSize({width:390,height:844});await page.goto('/interviews/trial?invitation='+id+'#access='+token);
 await expect(page.getByRole('button',{name:/14:00/})).toBeVisible();expect(entries).toBe(1);expect(new URL(page.url()).hash).toBe('');
 await page.getByRole('button',{name:/14:00/}).click();await page.getByRole('button',{name:'選んだ日程を確認する'}).click();await expect(page.getByRole('button',{name:'予約希望を送信する'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('無効リンクでは生徒や日程を取得しない',async({page})=>{
 let reads=0;await page.route('**/api/parent/invitation-entry',r=>r.fulfill({status:401,json:{error:'このリンクの受付は終了しました。最新の案内LINEを確認してください。'}}));
 await page.route('**/api/staff/interview-live-preview*',r=>{reads++;return r.fulfill({json:state})});
 await page.goto('/interviews/trial?invitation='+id+'#access='+token);await expect(page.getByRole('status')).toContainText('このリンクの受付は終了しました');expect(reads).toBe(0);expect(new URL(page.url()).hash).toBe('');
});
