import { expect, test } from "@playwright/test";
import { setupRegistration } from "./registration-fixture";
for (const entry of ["candidates", "students"]) test(`${entry} navigates to one page and returns without writing`, async ({ page }) => {
  const { writes } = await setupRegistration(page, { linked: false });
  await page.setViewportSize({ width: 390, height: 844 });
  if (entry === "candidates") {
    await page.goto("/attendance");
    await page.getByRole("button", { name: "生徒本人・保護者のLINE登録候補を表示", exact: true }).click();
    await page.getByRole("link", { name: "生徒本人・保護者を登録", exact: true }).click();
  } else {
    await page.goto("/students");
    await page.getByRole("row").filter({ hasText: "UI-ONE" }).click();
    await page.getByPlaceholder("LINE名・登録名で検索").fill("登録試験LINE");
    await page.getByRole("link", { name: "旧登録名 (登録試験LINE)" }).click();
  }
  await expect(page).toHaveURL(/\/line-registration\?/);
  await expect(page.getByRole("region", { name: "生徒本人・保護者のLINE登録", exact: true })).toBeVisible();
  await page.getByRole("button", { name: entry === "candidates" ? "← 欠席確認に戻る" : "← 生徒一覧に戻る", exact: true }).click();
  await expect(page).toHaveURL(entry === "candidates" ? /\/attendance$/ : /\/students$/);
  expect(writes).toHaveLength(0);
});
test("direct URL and reload work with a safe return destination", async ({ page }) => {
  const { writes } = await setupRegistration(page);
  await page.goto("/line-registration?userId=ui-line&returnTo=https://evil.invalid&mode=name");
  await expect(page.getByRole("heading", { name: "LINE登録・修正", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("勉たんに表示する名前")).toHaveValue("旧登録名");
  await page.getByRole("button", { name: "← 連絡先管理に戻る", exact: true }).click();
  await expect(page).toHaveURL(/\/contacts$/);
  expect(writes).toHaveLength(0);
});
test("registration load failure blocks writes and can return", async ({ page }) => {
  const { writes } = await setupRegistration(page, { loadFail: true });
  await page.goto("/attendance");
  await page.getByRole("link", { name: "兄弟・双子のLINE紐付け", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "LINE登録・修正", exact: true }).getByRole("alert")).toContainText("登録情報を取得できませんでした");
  await expect(page.getByRole("button", { name: "この内容で登録して一覧の名前を更新" })).toHaveCount(0);
  await page.getByRole("button", { name: "← 欠席確認に戻る", exact: true }).click();
  expect(writes).toHaveLength(0);
});
test("browser back and forward retain the source and dismiss the page", async ({ page }) => {
  await setupRegistration(page);
  await page.goto("/attendance");
  await page.getByRole("link", { name: "勉たんの名前を直す", exact: true }).click();
  await expect(page.getByLabel("勉たんに表示する名前")).toHaveValue("旧登録名");
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "LINE登録・修正", exact: true })).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole("dialog", { name: "LINE登録・修正", exact: true })).toBeVisible();
});

test("design HTML works at phone width", async ({ page }) => {
  const { pathToFileURL } = await import("node:url");
  const path = await import("node:path");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(path.resolve("docs/line-registration-page-design.html")).href);
  await page.getByRole("button", { name: "欠席確認", exact: true }).click();
  await page.getByRole("button", { name: "生徒・続柄・兄弟を登録する", exact: true }).click();
  await page.getByRole("button", { name: "← 欠席確認に戻る", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("元画面に戻りました");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "analysis_outputs/line-registration-design-mobile.png", fullPage: true });
});
