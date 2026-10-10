import { expect, type Page } from "@playwright/test";

export async function selectConfirmer(page: Page, name: string) {
  const picker = page.locator('[aria-label="LINE確認担当者"]').last();
  await expect(picker).toBeVisible();
  const change = picker.getByRole("button", { name: "担当者を変更" });
  if (await change.isVisible()) {
    if (await picker.getByText(`確認担当者：${name}`, { exact: true }).isVisible()) return;
    await change.click();
  }
  const retry = picker.getByRole("button", { name: "再試行" });
  if (await picker.getByLabel("確認担当者を入力").isDisabled() && !await retry.isVisible()) await page.reload();
  await expect.poll(async () => await retry.isVisible() || await picker.getByLabel("確認担当者を入力").isEnabled()).toBe(true);
  if (await retry.isVisible()) await retry.click();
  await picker.getByLabel("確認担当者を入力").fill(name);
  await picker.getByRole("button", { name: "この担当者で続ける" }).click();
  await expect(picker).toContainText(`確認担当者：${name}`);
}
