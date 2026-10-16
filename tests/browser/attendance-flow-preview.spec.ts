import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

for (const width of [390, 1280]) test(`attendance flow review works at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(pathToFileURL(path.resolve("docs/attendance-line-flow-review-20261016.html")).href);
  for (const label of ["勉たんの名前を直す", "LINEの登録を確認・修正", "対応する"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (label === "勉たんの名前を直す") {
      await page.getByLabel("勉たんに表示する名前").fill("修正した名前");
      await page.getByRole("button", { name: "この名前で保存（操作見本）", exact: true }).click();
      await expect(page.locator("#name-status")).toContainText("表示名を更新しました");
    }
    if (label === "対応する") {
      const group = page.locator('[aria-label="連絡した生徒の候補"]');
      await expect(group.getByRole("button", { pressed: true })).toContainText("選択中：");
      await group.getByRole("button", { pressed: false }).click();
      await expect(group.getByRole("button", { pressed: true })).toContainText("試験二郎");
    }
    await page.getByRole("button", { name: "← 欠席確認に戻る", exact: true }).click();
  }
  await page.screenshot({ path: `analysis_outputs/attendance-flow-preview-${width}.png`, fullPage: true });
});
