import { expect, test } from "@playwright/test";

test("担任を選ぶと秋のアンケート対象生徒を表示する", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "担当生徒の回答を確認してください" })).toBeVisible();
  await expect(page.getByText("回答 29件")).toBeVisible();
  await page.getByRole("button", { name: "工藤先生 8" }).click();
  await expect(page.getByText("工藤先生の担当")).toBeVisible();
  await expect(page.getByRole("link", { name: /澤田青弥/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "確認済み" })).toHaveCount(8);
  await expect(page.getByRole("button", { name: "確認済み" }).first()).toBeDisabled();
});

test("教室画面のヘッダーには勉たんを表示しない", async ({ page }) => {
  await page.goto("/classroom");

  const topbar = page.locator(".app-topbar");
  await expect(topbar).toContainText("教室の出欠確認");
  await expect(topbar).not.toContainText("勉たん");
});
