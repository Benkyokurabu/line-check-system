import { test, expect } from "@playwright/test";
import { buildSchedulePreview, scheduleRows } from "../../src/lib/schedule-preview.mjs";

test("one button reads cloud schedule and retries errors without file selection", async ({ page }) => {
  const item = { date: "2026-09-07", time: "6:35～8:05", grade: "j1", class: "S", subject: "eng", campus: "hon", room: "1", groupKey: "hon_j1_S_eng", label: "中１S 英語", teacher: "確認用講師" };
  const existing = scheduleRows([item], "2026-09").map((r) => ({ ...r, id: "test-lesson" }));
  const references = { "test-lesson": 1 };
  const report = { ...buildSchedulePreview([{ ...item, room: "2" }], existing, "2026-09", references), existing, references,
    generatedAt: "2026-09-07T10:00:00Z", source: { file: "2026年9月スケジュール.xlsm" } };
  let fail = false;
  let checks = 0;
  await page.route("**/api/schedule/preview*", async (route) => {
    expect(route.request().method()).toBe("GET");
    if (!new URL(route.request().url()).searchParams.has("month")) return route.fulfill({ json: { months: [{ month: "2026-09" }] } });
    checks++;
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: "OneDriveに接続できませんでした。" } : report });
  });
  await page.goto("/schedule-import");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "スケジュールを確認", exact: true })).toBeEnabled();
  await page.getByLabel("対象月", { exact: true }).fill("2026-09");
  await page.getByRole("button", { name: "スケジュールを確認", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2026-09 の確認結果" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /本校 1教室/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /本校 2教室/ })).toBeVisible();
  await expect(page.getByText(/変更対象に欠席/)).toBeVisible();
  await page.getByRole("button", { name: "原本の授業一覧を見る" }).click();
  await expect(page.getByLabel("校舎", { exact: true })).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "スケジュールを確認", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "OneDriveに接続できませんでした。" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2026-09 の確認結果" })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "スケジュールを確認", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2026-09 の確認結果" })).toBeVisible();
  expect(checks).toBe(3);
});
