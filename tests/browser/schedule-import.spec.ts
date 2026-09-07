import { test, expect } from "@playwright/test";
import { buildSchedulePreview, scheduleRows } from "../../src/lib/schedule-preview.mjs";

test("schedule report is reviewed locally, changes are visible, and invalid files clear it", async ({ page }) => {
  const item = { date: "2026-09-07", time: "6:35～8:05", grade: "j1", class: "S", subject: "eng", campus: "hon", room: "1", groupKey: "hon_j1_S_eng", label: "中１S 英語", teacher: "確認用講師" };
  const existing = scheduleRows([item], "2026-09").map((r) => ({ ...r, id: "test-lesson" }));
  const references = { "test-lesson": 1 };
  const report = { ...buildSchedulePreview([{ ...item, room: "2" }], existing, "2026-09", references), existing, references,
    generatedAt: "2026-09-07T10:00:00Z", source: { file: "2026年9月スケジュール.xlsm" } };
  const mutations: string[] = [];
  page.on("request", (r) => { if (r.method() !== "GET") mutations.push(r.url()); });
  await page.goto("/schedule-import");
  await page.getByLabel("取込処理で作成した確認ファイルを開く").setInputFiles({ name: "preview.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(report)) });
  await expect(page.getByRole("heading", { name: "2026-09 の確認結果" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /本校 1教室/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /本校 2教室/ })).toBeVisible();
  await expect(page.getByText(/変更対象に欠席/)).toBeVisible();
  await page.getByRole("button", { name: "原本の授業一覧を見る" }).click();
  await expect(page.getByLabel("校舎", { exact: true })).toBeVisible();
  await page.getByLabel("取込処理で作成した確認ファイルを開く").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(page.getByRole("alert").filter({ hasText: "勉たんのスケジュール確認ファイルを選択してください。" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2026-09 の確認結果" })).toHaveCount(0);
  expect(mutations).toEqual([]);
});
