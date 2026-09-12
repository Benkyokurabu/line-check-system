import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  const state = { reads: 0, checks: 0, processed: 2, failRefresh: false, failCheck: false };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3197") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/attendance/extract") {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ limit: 10 });
      state.checks++;
      if (state.failCheck) return route.fulfill({ status: 500, json: { error: "チェックに失敗しました" } });
      return route.fulfill({ json: { processed: state.processed, candidates: 1, ignored: 0, retrying: 1, dead: 0 } });
    }
    expect(route.request().method()).toBe("GET");
    if (url.pathname === "/api/attendance/candidates") {
      state.reads++;
      if (state.failRefresh) return route.fulfill({ status: 500, json: { error: "一覧取得失敗" } });
      return route.fulfill({ json: { candidates: [] } });
    }
    if (url.pathname === "/api/attendance/status") return route.fulfill({ json: {
      queued: 3, ready: 2, processing: 1, retry_wait: 1, dead: 0,
      last_worker_succeeded_at: "2026-09-09T09:00:00Z", last_checked_at: "2026-09-10T09:00:00Z",
    } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/attendance");
  await expect(page.getByText(/未チェック 3件/)).toBeVisible();
  await expect(page.getByRole("status")).toContainText("2件をチェックしました");
  return state;
}

test("opening and explicit refresh process pending LINE before reloading", async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByText("自動チェック：1分ごと")).toBeVisible();
  await expect(page.getByText(/直近5分間に限らず/)).toBeHidden();
  await expect(page.getByText(/一覧の更新時刻：/)).toBeHidden();
  await expect(page.getByText(/画面を開いたとき・戻ったとき・表示中の1分ごとに、/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "最新の遅刻・欠席連絡を確認" }).getByRole("textbox", { name: "確認者名", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "最新のLINEを確認して更新", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("2件をチェックしました");
  expect(state.checks).toBe(2);
  expect(state.reads).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "最新のLINEを確認して更新", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("2件をチェックしました");
  await expect(page.getByRole("status")).toContainText("再試行待ち1件");
  expect(state.checks).toBe(3);
  expect(state.reads).toBeGreaterThanOrEqual(4);
  await page.getByText("自動チェックの仕組み・処理状況", { exact: true }).click();
  await expect(page.getByText(/直近5分間に限らず/)).toBeVisible();
  await expect(page.getByText(/一覧の更新時刻：/)).toBeVisible();
  await expect(page.getByText(/直近の処理正常終了/)).toContainText("09/09");
  await expect(page.getByText(/直近の処理正常終了/)).toContainText("09/10");
  await page.screenshot({ path: "test-results/attendance-check-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "最新のLINEを確認して更新", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/attendance-check-mobile.png", fullPage: true });
});

test("zero processed never implies all messages checked and reload failure preserves processing outcome", async ({ page }) => {
  const state = await setup(page);
  state.processed = 0;
  await page.getByRole("button", { name: "最新のLINEを確認して更新", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("今回すぐにチェックできるLINEはありませんでした");
  state.processed = 2;
  state.failRefresh = true;
  await page.getByRole("button", { name: "最新のLINEを確認して更新", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("2件をチェックしました");
  await expect(page.getByRole("status")).toContainText("一覧または処理状況の更新に失敗");
  state.failCheck = true;
  await page.getByRole("button", { name: "最新のLINEを確認して更新", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("チェックに失敗しました");
  await expect(page.getByRole("button", { name: "最新のLINEを確認して更新", exact: true })).toBeEnabled();
});

test("visible page periodically checks latest LINE and returning to the page refreshes it", async ({ page }) => {
  await page.clock.install();
  const state = await setup(page);
  expect(state.checks).toBe(1);
  await expect(page.getByText("普段はこちら", { exact: true })).toHaveCount(0);
  await page.clock.runFor(60000);
  await expect.poll(() => state.checks).toBe(2);
  await expect(page.getByRole("button", { name: "最新のLINEを確認して更新", exact: true })).toBeEnabled();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => state.checks).toBe(3);
});
