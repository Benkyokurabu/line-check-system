import { expect, test } from "@playwright/test";

const staff = { staffId: "staff-test", staffCode: "AVAIL_teacher-test", displayName: "工藤", role: "teacher" };
const answerId = "11111111111141118111111111111111";

for (const width of [1280, 390]) {
  test(`一度の先生ログインを欠席確認・アンケート・面談資料で共有する (${width}px)`, async ({ page }) => {
    let logins = 0;
    const signedIn = (cookie: string | undefined) => cookie?.includes("bentan-test-session=authenticated");
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/**", route => route.fulfill({ json: { candidates: [], students: [], groups: [], events: [], lessons: [] } }));
    await page.route("**/api/admin/teachers", route => route.fulfill({ json: { teachers: [{ id: "teacher-test", display_name: "工藤" }] } }));
    await page.route("**/api/staff/availability-login", route => {
      logins++;
      return route.fulfill({ headers: { "Set-Cookie": "bentan-test-session=authenticated; Path=/; HttpOnly; SameSite=Lax" }, json: { staff } });
    });
    await page.route("**/api/staff/session", async route => {
      expect(route.request().method()).toBe("GET");
      return route.fulfill(signedIn((await route.request().allHeaders()).cookie) ? { json: { staff } } : { status: 401, json: { error: "ログインしてください" } });
    });
    await page.route("**/api/staff/session/activity", async route => route.fulfill({ json: { authenticated: !!signedIn((await route.request().allHeaders()).cookie) } }));
    await page.route("**/api/interview-surveys", route => route.fulfill({ json: { groups: [{ teacher: "工藤", students: [{ grade: "中3", name: "共有確認生徒", notionUrl: `https://app.notion.com/p/${answerId}`, submittedAt: "2026-10-09" }] }] } }));
    await page.route("**/api/interview-surveys/confirmations", route => route.fulfill({ json: { states: [] } }));
    await page.route("**/api/interview-surveys/scheduling", async route => {
      expect(signedIn((await route.request().allHeaders()).cookie)).toBe(true);
      return route.fulfill({ json: { states: {} } });
    });
    await page.route("**/api/staff/survey-workflow?answer=*", async route => {
      expect(signedIn((await route.request().allHeaders()).cookie)).toBe(true);
      return route.fulfill({ json: { student: { name: "共有確認生徒", number: "test", grade: "中3" }, staffName: "工藤", survey: { id: answerId, date: "", time: "", editedAt: "v1" }, accounts: [], record: null } });
    });
    await page.goto("/staff/interview-availability");
    await page.getByRole("combobox", { name: "先生の名前", exact: true }).selectOption("teacher-test");
    await page.getByLabel("共通パスワード", { exact: true }).fill("isolated-test-password");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page.getByLabel("共通パスワード", { exact: true })).toHaveCount(0);
    await page.goto("/attendance");
    await expect(page.getByRole("heading", { name: "遅刻・欠席連絡の確認", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /パスワード/ })).toHaveCount(0);
    await page.goto("/staff/surveys/2026-autumn");
    await page.getByRole("combobox", { name: "アンケートの担任" }).selectOption("工藤");
    await page.getByRole("button", { name: "共有確認生徒：日程連絡・面談記録・LINE" }).click();
    await expect(page.getByRole("region", { name: "面談入力" }).getByText("学籍番号 test", { exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "面談の職員ログイン" })).toHaveCount(0);
    await page.screenshot({ path: `test-results/shared-staff-session-${width}.png`, fullPage: true });
    await page.goto("/staff/interview-materials");
    await expect(page.getByRole("heading", { name: "1. 生徒を選ぶ", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "先生ログイン", exact: true })).toHaveCount(0);
    await page.goto("/staff/interview-availability");
    await expect(page.getByRole("button", { name: "ログアウト", exact: true })).toBeVisible();
    expect(logins).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("欠席確認を使っている間もログインを維持し、別タブのログインを入力保持で引き継ぐ", async ({ page }) => {
  await page.clock.install();
  let authenticated = true;
  let activityReads = 0;
  await page.route("**/api/**", route => route.fulfill({ json: { candidates: [], students: [], groups: [], events: [], lessons: [] } }));
  await page.route("**/api/staff/session/activity", route => {
    activityReads++;
    return route.fulfill({ json: { authenticated } });
  });
  await page.goto("/attendance");
  await expect.poll(() => activityReads).toBe(1);
  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => activityReads).toBe(2);
  await page.clock.fastForward(5 * 60 * 1000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenReads = activityReads;
  await page.clock.fastForward(10 * 60 * 1000);
  expect(activityReads).toBe(hiddenReads);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => activityReads).toBe(hiddenReads + 1);

  await page.route("**/api/staff/survey-workflow?answer=*", route => route.fulfill(authenticated
    ? { json: { student: { name: "入力保持生徒", number: "test", grade: "中3" }, staffName: "工藤", survey: { id: answerId, date: "2026-10-09", editedAt: "v1" }, accounts: [], record: { id: "record", body: "", blockId: "block", blockEditedAt: "v1", editable: true } } }
    : { status: 401, json: { error: "ログインし直してください。" } }));
  await page.route("**/api/staff/survey-workflow", route => {
    expect(route.request().method()).toBe("POST");
    authenticated = false;
    return route.fulfill({ status: 401, json: { error: "ログインし直してください。" } });
  });
  await page.goto(`/staff/survey-workflow?answer=${answerId}`);
  await page.clock.runFor(100);
  await page.getByLabel("面談内容", { exact: true }).fill("入力途中の記録");
  await page.getByRole("button", { name: "面談記録を更新", exact: true }).click();
  await expect(page.getByRole("form", { name: "面談の職員ログイン" })).toBeVisible();
  authenticated = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("form", { name: "面談の職員ログイン" })).toHaveCount(0);
  await expect(page.getByLabel("面談内容", { exact: true })).toHaveValue("入力途中の記録");
});

test("未ログインの日常画面にログインを追加せず、生徒画面のセッションを維持しない", async ({ page, request }) => {
  const response = await request.get("/api/staff/session/activity");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ authenticated: false });
  let reads = 0;
  await page.route("**/api/staff/session/activity", route => { reads++; return route.fulfill({ json: { authenticated: false } }); });
  await page.goto("/self-study-room/trial");
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  expect(reads).toBe(0);
});
