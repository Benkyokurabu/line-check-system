import { expect, type Page } from "@playwright/test";

export async function selectConfirmer(page: Page, name: string) {
  const picker = page.locator('[aria-label="LINE確認担当者"]').last();
  await expect(picker).toBeVisible();
  const change = picker.getByRole("button", { name: "担当者を変更" });
  if (await change.isVisible()) {
    if (await picker.getByText(`確認担当者：${name}`, { exact: true }).isVisible()) return;
    await change.click();
  }
  await page.route("**/api/admin/teachers", route => route.fulfill({ json: { teachers: [{ display_name: name }] } }));
  const retry = picker.getByRole("button", { name: "再試行" });
  if (await picker.getByLabel("確認担当者を選択").isDisabled() && !await retry.isVisible()) await page.reload();
  await expect.poll(async () => await retry.isVisible() || await picker.getByLabel("確認担当者を選択").isEnabled()).toBe(true);
  if (await retry.isVisible()) await retry.click();
  await picker.getByLabel("確認担当者を選択").selectOption({ label: "候補にない担当者" });
  await picker.getByLabel("担当者名").fill(name);
  await picker.getByRole("button", { name: "この担当者で続ける" }).click();
  await expect(picker).toContainText(`確認担当者：${name}`);
}
