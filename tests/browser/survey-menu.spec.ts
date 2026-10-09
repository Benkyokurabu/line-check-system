import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`アンケートの選択・回答・戻る操作ができる (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/interview-surveys", route => route.fulfill({ json: { groups: [{ teacher: "工藤", students: [{ grade: "中3", name: "架空花子", notionUrl: "https://app.notion.com/p/11111111111141118111111111111111", submittedAt: "2026-09-16T00:00:00Z" }] }] } }));
    await page.route("**/api/interview-surveys/confirmations", route => route.fulfill({ json: { states: [] } }));
    await page.route("**/api/interview-surveys/scheduling", route => route.fulfill({ json: { states: {} } }));
    await page.goto("/");
    await page.getByRole("navigation", { name: "機能の分類" }).getByRole("button", { name: "面談・予約関連", exact: true }).click();
    await expect(page.getByRole("heading", { name: "担当生徒の回答を確認してください" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "面談の予約", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/staff/interviews"]')).toHaveCount(0);
    await page.getByRole("link", { name: /アンケートを確認する/ }).click();
    await expect(page).toHaveURL(/\/staff\/surveys$/);
    const campaigns = page.getByRole("region", { name: "アンケートを選択" });
    await expect(page.locator('a[href="/staff/interviews"]')).toHaveCount(0);
    await expect(campaigns.getByRole("link")).toHaveCount(1);
    await campaigns.getByRole("link", { name: /2026年秋のアンケート/ }).click();
    await expect(page).toHaveURL(/\/staff\/surveys\/2026-autumn$/);
    await page.getByRole("combobox", { name: "アンケートの担任" }).selectOption("工藤");
    await expect(page.getByRole("list", { name: "工藤先生のアンケート回答" })).toContainText("架空花子");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/survey-detail-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: "← アンケート一覧に戻る" }).click();
    await expect(campaigns).toBeVisible();
    await page.screenshot({ path: `test-results/survey-list-${width}.png`, fullPage: true });
  });
}
