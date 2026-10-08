import { expect, test } from "@playwright/test";

const menu = [
  { heading: "日常業務", titles: ["欠席連絡の確認", "教室への連絡"] },
  { heading: "面談", titles: ["面談の予定・入力", "面談資料を作る", "予約可能枠を作る"] },
  { heading: "授業・管理", titles: ["録画の公開設定", "授業スケジュール取込", "連絡先管理", "クラス一覧表の取り込み", "Notion・クラス一覧 照合", "LINE登録名の取り込み", "改善してほしいことなど、何でも"] },
  { heading: "本番運用前", titles: ["未対応メッセージ", "担任・クラス別 生徒一覧", "生徒カルテ", "自習室管理", "自習室予約"] },
];

test("home menu keeps the approved order and existing destinations", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { groups: [], states: {}, records: [] } }));
  await page.goto("/");
  const categories = page.getByRole("navigation", { name: "機能の分類" });
  await expect(categories.getByRole("button")).toHaveText(["ホーム", ...menu.map(group => group.heading)]);
  for (const group of menu) {
    const section = page.getByRole("region", { name: group.heading });
    await expect(section.locator("h3")).toHaveText(group.titles);
  }
  await page.screenshot({ path: "test-results/home-menu-approved-desktop.png", fullPage: true });
  await expect(page.getByRole("heading", { name: "未実装" })).toHaveCount(0);
  await categories.getByRole("button", { name: "日常業務" }).click();
  await expect(page.getByRole("region", { name: "日常業務" }).locator("h3")).toHaveText(menu[0].titles);
  await expect(page.getByRole("region", { name: "本番運用前" })).toHaveCount(0);
  await categories.getByRole("button", { name: "本番運用前" }).click();
  await expect(page.getByRole("region", { name: "本番運用前" }).locator("h3")).toHaveText(menu[3].titles);
});

test("staff sidebar follows the categories without changing compact student pages", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { candidates: [], students: [], groups: [], events: [], lessons: [] } }));
  await page.goto("/attendance");
  const groups = page.locator(".app-nav-group");
  await expect(groups.locator("p")).toHaveText(menu.map(group => group.heading));
  for (let index = 0; index < menu.length; index++) await expect(groups.nth(index).getByRole("link")).toHaveText(menu[index].titles);
  for (const path of ["/dashboard", "/students", "/karte"]) {
    await page.goto(path);
    await expect(page.locator('.app-sidebar a[aria-current="page"]')).toHaveAttribute("href", path);
  }
  await page.goto("/self-study-room/trial");
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
});

test("approved home menu fits a narrow screen", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { groups: [], states: {}, records: [] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "本番運用前" }).locator("h3")).toHaveText(menu[3].titles);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/home-menu-approved-mobile.png", fullPage: true });
});
