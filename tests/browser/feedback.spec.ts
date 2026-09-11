import { expect, test } from "@playwright/test";

test("home exposes submission only; failed submission retries the same operation and displays completion", async ({ page }) => {
  const writes: { id: string; name: string; message: string; sharingPreference:string }[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(String(test.info().project.use.baseURL)).origin) return route.abort();
    if (url.pathname === "/api/feedback") {
      writes.push(route.request().postDataJSON());
      if (writes.length === 1) return route.abort("connectionreset");
      return route.fulfill({ json: { accepted: true } });
    }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.goto("/");
  await expect(page.locator('a[href*="private-feedback"]')).toHaveCount(0);
  await page.getByRole("link", { name: /改善してほしいことなど、何でも/ }).click();
  await page.getByLabel("名前", { exact: true }).fill("試験職員");
  await page.getByLabel("内容", { exact: true }).fill("授業一覧を見やすくしたい\n<script>scriptは実行しない</script>");
  await page.getByRole("button", { name: "送信する", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("内容", { exact: true })).toHaveValue(/授業一覧/);
  await page.getByRole("button", { name: "送信する", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("送信しました");
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[0].sharingPreference).toBe("anonymous");
  await expect(page.getByText(/希望も伝えました/)).toBeVisible();
  await expect(page.locator('a[href*="private-feedback"]')).toHaveCount(0);
});

test("inbox shows no data before authorized login, renders text safely and clears data on logout", async ({ page }) => {
  let loggedIn = false;
  let mode: "owner" | "other" = "other";
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(String(test.info().project.use.baseURL)).origin) return route.abort();
    if (url.pathname === "/api/private-feedback") {
      if (!loggedIn) return route.fulfill({ status: 401, json: { error: "ログインしてください。" } });
      if (mode === "other") return route.fulfill({ status: 403, json: { error: "権限なし" } });
      return route.fulfill({ json: { feedback: [{ id: "test", sender_name: "試験職員", message: "<script>window.unsafe=true</script>\n改善案", created_at: "2026-09-10T06:00:00Z", sharing_preference:"anonymous" }], hasMore: false } });
    }
    if (url.pathname === "/api/staff/session") {
      if (route.request().method() === "DELETE") loggedIn = false;
      else {
        expect(route.request().postDataJSON().staffCode).toBe("KUDO");
        loggedIn = true;
      }
      return route.fulfill({ json: {} });
    }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.goto("/private-feedback");
  await expect(page.getByText("試験職員", { exact: true })).toHaveCount(0);
  await page.getByLabel("工藤のパスワード").fill("test-only");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("工藤専用");
  await expect(page.getByText("試験職員", { exact: true })).toHaveCount(0);
  mode = "owner";
  await page.getByLabel("工藤のパスワード").fill("test-only");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByText("試験職員", { exact: true })).toBeVisible();
  await expect(page.getByText(/<script>window.unsafe=true/)).toBeVisible();
  await expect(page.getByText("匿名希望：他の職員へ紹介するときは名前を出さない",{exact:true})).toBeVisible();
  expect(await page.evaluate(() => "unsafe" in window)).toBe(false);
  await page.screenshot({ path: "test-results/feedback-inbox.png", fullPage: true });
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page.getByLabel("工藤のパスワード")).toBeVisible();
  await expect(page.getByText("試験職員", { exact: true })).toHaveCount(0);
});

test('sender can allow their name to be shared and the chosen preference is submitted',async({page})=>{
 const writes:Record<string,unknown>[]=[];
 await page.route('**/api/feedback',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{accepted:true}});});
 await page.goto('/feedback');
 await expect(page.getByRole('radio',{name:/名前を出さずに紹介してほしい/})).toBeChecked();
 await expect(page.getByText('工藤には名前と内容が届きます。他の職員へ紹介する際の希望を選んでください。')).toBeVisible();
 await page.getByLabel('名前',{exact:true}).fill('試験職員');
 await page.getByLabel('内容',{exact:true}).fill('予定を確認しやすくしてほしい');
 await page.getByRole('radio',{name:/名前を出してもよい/}).check();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'analysis_outputs/feedback-sharing-20260911.png',fullPage:true});
 await page.getByRole('button',{name:'送信する',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('送信しました');
 expect(writes[0]).toMatchObject({name:'試験職員',sharingPreference:'named'});
 await expect(page.getByText('「他の職員へ名前を出して紹介してもよい」という希望も伝えました。')).toBeVisible();
});
