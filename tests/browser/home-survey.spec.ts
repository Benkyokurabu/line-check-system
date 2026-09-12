import { expect, test } from "@playwright/test";

test("確認状態の切替・行の非表示・提出日時の古い順表示ができる", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "担当生徒の回答を確認してください" })).toBeVisible();
  await expect(page.getByText("表示中 31件")).toBeVisible();
  await page.getByRole("button", { name: "工藤先生 8" }).click();
  await expect(page.getByText("工藤先生の担当")).toBeVisible();

  const list = page.getByRole("list", { name: "工藤先生のアンケート回答" });
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0)).toContainText("澤田青弥");
  await expect(rows.nth(0)).toContainText("提出 9/12 10:14");
  await expect(rows.nth(1)).toContainText("柴田 茉侑");
  await expect(rows.nth(2)).toContainText("山本美緒");

  const sawadaRow = rows.filter({ hasText: "澤田青弥" });
  await sawadaRow.getByRole("button", { name: "未確認" }).click();
  await expect(sawadaRow.getByRole("button", { name: "確認済み" })).toBeEnabled();
  await sawadaRow.getByRole("button", { name: "確認済み" }).click();
  await expect(sawadaRow.getByRole("button", { name: "未確認" })).toBeVisible();

  await sawadaRow.getByRole("button", { name: "確認したのでこの行を削除する" }).click();
  await expect(sawadaRow).not.toBeVisible();
  await expect(page.getByRole("button", { name: "工藤先生 7" })).toBeVisible();
  await expect(page.getByText("表示中 30件")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "工藤先生 7" }).click();
  await expect(page.getByRole("list", { name: "工藤先生のアンケート回答" }).getByText("澤田青弥")).not.toBeVisible();
});

test("更新するボタンでNotionから受け取った一覧に差し替える", async ({ page }) => {
  await page.route("**/api/interview-surveys", async route => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        updatedAt: "2026-09-12T10:00:00.000Z",
        groups: [{
          teacher: "工藤",
          students: [{
            grade: "中1",
            name: "更新確認生徒",
            notionUrl: "https://app.notion.com/p/refresh-test",
            submittedAt: "2026-09-12T09:30:00.000Z",
          }],
        }],
      }),
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "更新する" }).click();
  await expect(page.getByRole("status")).toContainText("Notionから最新の回答を更新しました。");
  await page.getByRole("button", { name: "工藤先生 1" }).click();
  await expect(page.getByRole("link", { name: /更新確認生徒/ })).toContainText("提出 9/12 18:30");
});

test("教室画面のヘッダーには勉たんを表示しない", async ({ page }) => {
  await page.goto("/classroom");

  const topbar = page.locator(".app-topbar");
  await expect(topbar).toContainText("教室の出欠確認");
  await expect(topbar).not.toContainText("勉たん");
});
