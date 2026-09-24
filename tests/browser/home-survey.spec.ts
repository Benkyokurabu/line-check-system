import { expect, test } from "@playwright/test";
test.beforeEach(async({page})=>{let states:unknown[]=[];await page.route('**/api/interview-surveys/confirmations',r=>{if(r.request().method()==='POST'){const c=r.request().postDataJSON().changes[0];states=[{page_id:c.pageId,confirmed:c.confirmed,version:c.version+1}];}return r.fulfill({json:{states}});});});

test('スマホで生徒検索・担任・対応状況を分かりやすく絞り込める',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/interview-surveys',r=>r.fulfill({json:{groups:[{teacher:'工藤',students:[
  {grade:'中3',name:'架空　花子',notionUrl:'https://app.notion.com/p/11111111111141118111111111111111',submittedAt:'2026-09-16T00:00:00Z'},
  {grade:'中1',name:'架空　太郎',notionUrl:'https://app.notion.com/p/22222222222242228222222222222222',submittedAt:'2026-09-16T01:00:00Z'},
 ]}]}}));
 await page.goto('/');await expect(page.getByRole('combobox',{name:'アンケートの担任'})).toContainText('工藤先生（2件）');
 await page.getByRole('searchbox',{name:'アンケートの生徒を検索'}).fill('架空花子');
 await expect(page.getByRole('link',{name:/架空\s*花子/})).toBeVisible();
 await expect(page.getByRole('link',{name:/架空\s*太郎/})).toHaveCount(0);
 await page.getByRole('combobox',{name:'架空　花子の対応状況'}).selectOption('confirmed');
 await page.getByRole('combobox',{name:'アンケートの対応状況'}).selectOption('needs-review');
 await expect(page.getByText('条件に合う回答はありません。')).toBeVisible();
 await page.getByRole('combobox',{name:'アンケートの対応状況'}).selectOption('all');
 const box=await page.getByRole('searchbox',{name:'アンケートの生徒を検索'}).boundingBox();
 expect(box!.x+box!.width).toBeLessThanOrEqual(390);
 await page.getByRole('heading',{name:'担当生徒の回答を確認してください'}).scrollIntoViewIfNeeded();
 await page.screenshot({path:'analysis_outputs/survey-mobile-ui.png',fullPage:false});
});

test('古い担任未特定のキャッシュを自動更新し確認状態は保持する',async({page})=>{
 const student={grade:'中3',name:'照合確認生徒',notionUrl:'https://app.notion.com/p/33333333333343338333333333333333',submittedAt:'2026-09-16T00:00:00Z'};
 await page.addInitScript(s=>{
  localStorage.setItem('bentan:2026-autumn-survey-data',JSON.stringify([{teacher:'担任未特定',students:[s]}]));
  localStorage.setItem('bentan:2026-autumn-survey-confirmed',JSON.stringify([s.notionUrl]));
 },student);
 await page.route('**/api/interview-surveys',r=>r.fulfill({json:{groups:[{teacher:'工藤',students:[student]}]}}));
 await page.goto('/');
 await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');
 await expect(page.getByRole('combobox',{name:'アンケートの担任'})).not.toContainText('担任未特定先生');
 await expect(page.getByRole('combobox',{name:'照合確認生徒の対応状況'})).toHaveValue('confirmed');
});

test("確認状態の切替・行の非表示・提出日時の古い順表示ができる", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "担当生徒の回答を確認してください" })).toBeVisible();
  await expect(page.getByText("表示中 31件")).toBeVisible();
  await page.getByRole("combobox", { name: "アンケートの担任" }).selectOption("工藤");
  await expect(page.getByText("工藤先生の担当")).toBeVisible();

  const list = page.getByRole("list", { name: "工藤先生のアンケート回答" });
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0)).toContainText("澤田青弥");
  await expect(rows.nth(0)).toContainText("提出 9/12 10:14");
  await expect(rows.nth(1)).toContainText("柴田 茉侑");
  await expect(rows.nth(2)).toContainText("山本美緒");

  const sawadaRow = rows.filter({ hasText: "澤田青弥" });
  const status=sawadaRow.getByRole("combobox", { name: "澤田青弥の対応状況" });
  await status.selectOption("confirmed");
  await expect(status).toHaveValue("confirmed");
  await status.selectOption("needs-review");
  await expect(status).toHaveValue("needs-review");

  await sawadaRow.getByRole("button", { name: "確認したのでこの行を削除する" }).click();
  await expect(sawadaRow).not.toBeVisible();
  await expect(page.getByRole("combobox", { name: "アンケートの担任" })).toContainText("工藤先生（7件）");
  await expect(page.getByText("表示中 30件")).toBeVisible();

  await page.reload();
  await page.getByRole("combobox", { name: "アンケートの担任" }).selectOption("工藤");
  await expect(page.getByRole("list", { name: "工藤先生のアンケート回答" }).getByText("澤田青弥")).not.toBeVisible();

  await page.getByRole("button", { name: "非表示一覧（1件）" }).click();
  const hiddenList = page.getByRole("list", { name: "非表示にしたアンケート回答" });
  const hiddenSawadaRow = hiddenList.getByRole("listitem").filter({ hasText: "澤田青弥" });
  await expect(hiddenSawadaRow).toContainText("工藤先生");
  await hiddenSawadaRow.getByRole("button", { name: "この行を戻す" }).click();
  await expect(page.getByRole("combobox", { name: "アンケートの担任" })).toContainText("工藤先生（8件）");
  await expect(page.getByText("表示中 31件")).toBeVisible();
  await expect(page.getByRole("button", { name: /非表示一覧/ })).not.toBeVisible();

  await page.reload();
  await page.getByRole("combobox", { name: "アンケートの担任" }).selectOption("工藤");
  await expect(page.getByRole("list", { name: "工藤先生のアンケート回答" }).getByText("澤田青弥")).toBeVisible();
});

test("一覧を最新に更新でNotionから受け取った一覧に差し替える", async ({ page }) => {
  await page.route("**/api/interview-surveys", async route => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        updatedAt: "2026-09-12T10:00:00.000Z",
        groups: [{
          teacher: "工藤",
          students: [{
            grade: "中1",
            name: "更新確認生徒",
            notionUrl: "https://app.notion.com/p/refresh-test",
            submittedAt: "2026-09-12T09:30:00.000Z",
          }],
        }],
      }),
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "一覧を最新に更新" }).click();
  await expect(page.getByText("Notionから最新の回答を更新しました。",{exact:true})).toBeVisible();
  await page.getByRole("combobox", { name: "アンケートの担任" }).selectOption("工藤");
  await expect(page.getByRole("link", { name: /更新確認生徒/ })).toContainText("提出 9/12 18:30");

  await page.reload();
  await expect(page.getByRole("combobox", { name: "アンケートの担任" })).toContainText("工藤先生（1件）");
  await expect(page.getByText("表示中 1件")).toBeVisible();
  await page.getByRole("combobox", { name: "アンケートの担任" }).selectOption("工藤");
  await expect(page.getByRole("link", { name: /更新確認生徒/ })).toBeVisible();
});

test("教室画面のヘッダーには勉たんを表示しない", async ({ page }) => {
  await page.goto("/classroom");

  const topbar = page.locator(".app-topbar");
  await expect(topbar).toContainText("遅刻・欠席確認");
  await expect(topbar).not.toContainText("勉たん");
});
