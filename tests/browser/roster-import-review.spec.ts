import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) test(`import review shows the unrestricted number scope and prevents selecting held rows (${width}px)`, async ({ page }) => {
  const review = { source: "notion", issues: [{ student_number: "2018267", previous_student_number: "2018200", student_name: "架空 一郎", reason: "同じNotionページの学籍番号が変更されています", source_file: "Notion生徒情報DB", notion_page_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }], held_student_numbers: ["2018267"] };
  await page.route("**/api/**", route => {
    if (route.request().url().includes("import-reviews")) return route.fulfill({ json: { reviews: [review] } });
    if (route.request().url().endsWith("/preview")) return route.fulfill({ json: {
      target: { notion_statuses: ["在塾", "見学中"] }, notion: { students: 1, skipped: 0 },
      excel: { students: 1, files: [], class_enrollments: 1 }, app: { students: 1, class_enrollments: 1 },
      counts: { add: 1 }, identity_review: review,
      candidates: [{ student_number: "2018267", kind: "add", can_apply: false, selected_by_default: false, changes: ["生徒情報の確認待ち"], notion: { student_name: "架空 一郎" }, app: null, excel: null }],
    } });
    return route.fulfill({ json: {} });
  });
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/admin/notion-roster");
  await expect(page.getByRole("heading", { name: "生徒情報の確認待ち" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Notionの元情報を開く" })).toHaveAttribute("href", "https://www.notion.so/aaaaaaaabbbbccccddddeeeeeeeeeeee");
  await page.getByRole("button", { name: "Notion + Excelを照合" }).click();
  await expect(page.getByText("学籍番号の下限なし。Notionは「在塾・見学中」の生徒を照合します。")).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await page.getByRole("button", { name: "表示中を選択" }).click();
  await expect(page.getByRole("button", { name: "選択した差分を反映 (0)" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/roster-no-number-cutoff-${width}.png`, fullPage: true });
});

for (const width of [390, 1280]) test(`improvement design is readable and interactive at ${width}px`, async ({ page }) => {
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  await page.setViewportSize({ width, height: 900 });
  await page.goto(pathToFileURL(resolve("docs/student-line-improvements-20261016.html")).href);
  await page.getByText("確認待ちの例を見る", { exact: true }).click();
  await expect(page.getByText(/架空 一郎：2018267/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
