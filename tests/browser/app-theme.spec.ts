import { expect, test } from "@playwright/test";

test("staff pages share the home palette and navigation without exposing the private inbox", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    if (route.request().url().includes("/schedule/status")) return route.fulfill({ json: { enabled: false, stale: false, months: [], runs: [] } });
    if (route.request().url().includes("/session") || route.request().url().includes("/private-feedback")) return route.fulfill({ status: 401, json: { error: "ログインしてください。" } });
    return route.fulfill({ json: { candidates: [], students: [], contacts: [], teachers: [], routes: [], events: [], lessons: [], messages: [], templates: [], conversations: [], classes: [] } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const path of ["/attendance", "/contacts", "/students", "/dashboard", "/karte", "/classroom-office", "/feedback", "/schedule-import", "/admin/notion-roster", "/line-alias-import"]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "業務ナビゲーション" })).toBeVisible();
    await expect(page.locator('.app-sidebar a[aria-current="page"]')).toHaveAttribute("href", path === "/line-alias-import" ? "/contacts" : path);
    await expect(page.locator('a[href="/private-feedback"]')).toHaveCount(0);
    await expect(page.locator(".app-sidebar")).toHaveCSS("background-color", "rgb(18, 38, 62)");
    expect(await page.locator("body").evaluate((element) => getComputedStyle(element).getPropertyValue("--accent").trim())).toBe("#137b73");
    if (["/attendance", "/contacts", "/feedback"].includes(path)) await page.screenshot({ path: `test-results/theme-${path.slice(1)}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/feedback");
  await expect(page.locator(".app-sidebar")).toBeHidden();
  await expect(page.getByRole("button", { name: "送信する" })).toBeVisible();
  await expect(page.locator(".app-topbar")).toHaveCSS("background-color", "rgb(18, 38, 62)");
  await page.screenshot({ path: "test-results/theme-feedback-mobile.png", fullPage: true });
  await page.goto("/private-feedback");
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  await expect(page.getByLabel("工藤のパスワード")).toBeVisible();
  await page.goto("/self-study-room/menu-preview");
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /トップページへ/ })).toHaveCount(0);
});
