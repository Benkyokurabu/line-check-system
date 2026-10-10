import { expect, test } from "@playwright/test";

const menu = [
  { heading: "【事務】日常業務", titles: ["欠席連絡の確認", "教室への連絡"] },
  { heading: "面談・予約関連", titles: ["アンケートを確認する", "面談資料を作る", "予約可能枠を作る", "予約可能枠をコピー"] },
  { heading: "授業・管理", titles: ["録画の公開設定", "授業スケジュール取込", "連絡先管理", "クラス一覧表の取り込み", "Notion・クラス一覧 照合", "LINE登録名の取り込み", "改善してほしいことなど、何でも"] },
  { heading: "本番運用前", titles: ["未対応メッセージ", "担任・クラス別 生徒一覧", "生徒カルテ", "自習室管理", "自習室予約"] },
];
const categoryIds = ["daily", "interview", "management", "prelaunch"];
const destinations = [
  ["/attendance", "/classroom-office"],
  ["/staff/surveys", "/staff/interview-materials", "/staff/interview-availability", "/staff/interview-availability/manual"],
  ["/staff/recordings", "/schedule-import", "/contacts", "/contacts#roster-import", "/admin/notion-roster", "/line-alias-import", "/feedback"],
  ["/dashboard", "/students", "/karte", "/staff/self-study-room/trial", "/self-study-room/trial"],
];

test("home menu keeps the approved order and existing destinations", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { groups: [], states: {}, records: [] } }));
  await page.goto("/");
  await expect(page.locator('main section h2').first()).toHaveText("【事務】日常業務");
  await expect(page.getByRole("heading", { name: "連絡・確認" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "よく使う業務" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /欠席連絡の確認/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /教室への連絡/ })).toHaveCount(1);
  const categories = page.getByRole("navigation", { name: "機能の分類" });
  await expect(categories.getByRole("button")).toHaveText(["ホーム", ...menu.map(group => group.heading)]);
  for (const group of menu) {
    const section = page.getByRole("region", { name: group.heading });
    await expect(section.locator("h3")).toHaveText(group.titles);
  }
  await page.screenshot({ path: "test-results/home-menu-approved-desktop.png", fullPage: true });
  await expect(page.getByRole("heading", { name: "未実装" })).toHaveCount(0);
  await categories.getByRole("button", { name: "【事務】日常業務" }).click();
  await expect(page.getByRole("region", { name: "【事務】日常業務" }).locator("h3")).toHaveText(menu[0].titles);
  await expect(page.getByRole("region", { name: "本番運用前" })).toHaveCount(0);
  await categories.getByRole("button", { name: "本番運用前" }).click();
  await expect(page.getByRole("region", { name: "本番運用前" }).locator("h3")).toHaveText(menu[3].titles);
});

test("staff sidebar follows the categories without changing compact student pages", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { candidates: [], students: [], groups: [], events: [], lessons: [] } }));
  await page.goto("/attendance");
  const groups = page.locator(".app-nav-group");
  await expect(groups.locator("p")).toHaveText(menu.map(group => group.heading));
  for (let index = 0; index < menu.length; index++) {
    const links = groups.nth(index).locator(":scope > a");
    await expect(links).toHaveText(menu[index].titles);
    for (let link = 0; link < destinations[index].length; link++) await expect(links.nth(link)).toHaveAttribute("href", destinations[index][link]);
  }
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
  await expect(page.locator('main section h2').first()).toHaveText("【事務】日常業務");
  await expect(page.getByRole("heading", { name: "連絡・確認" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "よく使う業務" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "本番運用前" }).locator("h3")).toHaveText(menu[3].titles);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/home-menu-approved-mobile.png", fullPage: true });
});

test("every sidebar category links to its real home section with keyboard focus and back/forward navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/**", route => route.fulfill({ json: { candidates: [], groups: [], states: {}, records: [] } }));
  await page.goto("/attendance");
  const sidebar = page.getByRole("navigation", { name: "業務ナビゲーション" });
  await sidebar.getByRole("link", { name: "トップページへ", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(sidebar.getByRole("link", { name: menu[0].heading, exact: true })).toBeFocused();
  for (let index = 0; index < menu.length; index++) {
    const id = `group-${categoryIds[index]}`;
    const link = sidebar.getByRole("link", { name: menu[index].heading, exact: true });
    await expect(link).toHaveAttribute("href", `/#${id}`);
    await link.focus();
    await expect(link).toBeFocused();
    expect(await link.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/#${id}`);
    const section = page.locator(`section#${id}`);
    await expect(section).toHaveCount(1);
    await expect(section).toHaveAccessibleName(menu[index].heading);
    await expect(section).toBeFocused();
    await expect(section.getByRole("heading", { name: menu[index].heading, exact: true })).toBeInViewport();
    await expect(section.locator("h3")).toHaveText(menu[index].titles);
    expect(await section.evaluate(element => getComputedStyle(element).outlineColor)).not.toBe("rgb(213, 151, 25)");
    await page.keyboard.press("Tab");
    await expect(section.getByRole("link").first()).toBeFocused();
    expect(await section.getByRole("link").first().evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
    await page.goBack();
    await expect(page).toHaveURL("/attendance");
    await expect(sidebar).toBeVisible();
    await expect(page.locator('.app-sidebar a[aria-current="page"]')).toHaveAttribute("href", "/attendance");
    await page.goForward();
    await expect(page).toHaveURL(`/#${id}`);
    await expect(section).toBeFocused();
    expect(await section.evaluate(element => getComputedStyle(element).outlineColor)).not.toBe("rgb(213, 151, 25)");
    await page.goBack();
    await expect(page).toHaveURL("/attendance");
  }
  await page.screenshot({ path: "test-results/sidebar-category-links-desktop.png", fullPage: true });
});

test("every category anchor works on mobile and restores a category hidden by home filters", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/**", route => route.fulfill({ json: { groups: [], states: {}, records: [] } }));
  for (let index = 0; index < menu.length; index++) {
    const id = `group-${categoryIds[index]}`;
    await page.goto(`/#${id}`);
    const section = page.locator(`section#${id}`);
    await expect(section).toHaveAccessibleName(menu[index].heading);
    await expect(section).toBeFocused();
    expect(await section.evaluate(element => getComputedStyle(element).outlineColor)).not.toBe("rgb(213, 151, 25)");
    await expect(section.getByRole("heading", { name: menu[index].heading, exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("navigation", { name: "機能の分類" }).getByRole("button", { name: "【事務】日常業務", exact: true }).click();
  await page.getByRole("searchbox", { name: "機能を探す" }).fill("欠席");
  await expect(page.locator("section#group-management")).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = "#group-management"; });
  await expect(page.locator("section#group-management")).toBeFocused();
  await expect(page.getByRole("searchbox", { name: "機能を探す" })).toHaveValue("");
  await expect(page.getByRole("navigation", { name: "機能の分類" }).getByRole("button", { name: "ホーム", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/home-category-anchor-mobile.png", fullPage: true });
});
