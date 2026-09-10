import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, count = 3) {
  const candidates = Array.from({ length: count }, (_, i) => ({
    id: `bulk-${i + 1}`, status: "confirmed", event_type: "absence", event_date: "2099-01-01", ai_confidence: 1,
    review_hidden_at: null as string | null, review_hidden_by: null as string | null,
    student_number: null, student_roster: null, lessons: null, attendance_candidate_items: [], reply_messages: [],
    suggested_student_name: `試験生徒${i + 1}`,
    line_messages: { text: `試験生徒${i + 1}の欠席連絡です。`, received_at: "2099-01-01T00:00:00Z", display_name: `保護者${i + 1}` },
  }));
  const state = { writes: [] as string[], failId: "", unexpected: [] as string[] };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3197") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname;
    if (path.endsWith("/visibility")) {
      const id = path.split("/").at(-2)!;
      state.writes.push(id);
      expect(route.request().method()).toBe("PATCH");
      const body = route.request().postDataJSON();
      expect(body.changed_by).toBe("操作試験");
      if (id === state.failId) return route.fulfill({ status: 500, json: { error: "試験用の保存エラー" } });
      const candidate = candidates.find((row) => row.id === id)!;
      candidate.review_hidden_at = body.hidden ? new Date().toISOString() : null;
      candidate.review_hidden_by = body.hidden ? body.changed_by : null;
      return route.fulfill({ json: { candidate } });
    }
    if (route.request().method() !== "GET") { state.unexpected.push(path); return route.abort(); }
    if (path.endsWith("/candidates")) return route.fulfill({ json: { candidates } });
    if (path.endsWith("/students")) return route.fulfill({ json: { students: [] } });
    if (path.endsWith("/reply-templates")) return route.fulfill({ json: { templates: ["確認しました。"] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/attendance");
  await page.getByRole("button", { name: "複数選択", exact: true }).click();
  return state;
}

test("select all affects only rendered cards and loading more never silently selects them", async ({ page }) => {
  const state = await setup(page, 23);
  await page.getByRole("button", { name: "表示中の20件をすべて選択" }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(20);
  await page.getByRole("button", { name: "続きを表示（残り3件）" }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(23);
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(20);
  await page.getByLabel("確認者名", { exact: true }).fill("操作試験");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "選択した20件の表示を消す" }).click();
  await expect(page.getByRole("status")).toContainText("20件の表示を消しました。");
  expect(state.writes).toHaveLength(20);
  expect(state.writes).not.toContain("bulk-21");
  expect(state.unexpected).toEqual([]);
  await expect(page.getByRole("button", { name: "表示中 3件", exact: true })).toBeVisible();
});

test("missing reviewer and cancelled confirmation make no changes", async ({ page }) => {
  const state = await setup(page);
  await page.getByRole("checkbox", { name: "試験生徒1の連絡を選択" }).check();
  await page.getByRole("button", { name: "選択した1件の表示を消す" }).click();
  await expect(page.getByRole("status")).toContainText("確認者名");
  expect(state.writes).toEqual([]);
  await page.getByLabel("確認者名", { exact: true }).fill("操作試験");
  page.once("dialog", async (dialog) => { expect(dialog.message()).toContain("試験生徒1"); await dialog.dismiss(); });
  await page.getByRole("button", { name: "選択した1件の表示を消す" }).click();
  expect(state.writes).toEqual([]);
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(1);
});

test("partial failure keeps only failed cards selected, retry persists and hidden cards can be restored", async ({ page }) => {
  const state = await setup(page);
  state.failId = "bulk-2";
  await page.getByLabel("確認者名", { exact: true }).fill("操作試験");
  await page.getByRole("button", { name: "表示中の3件をすべて選択" }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "選択した3件の表示を消す" }).click();
  await expect(page.getByRole("status")).toContainText("2件の表示を消しました。1件は変更を確認できませんでした。");
  await expect(page.getByRole("checkbox", { name: "試験生徒2の連絡を選択" })).toBeChecked();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  state.failId = "";
  await page.getByRole("button", { name: "選択した1件の表示を消す" }).click();
  await expect(page.getByRole("status")).toContainText("1件の表示を消しました。");
  expect(state.writes.filter((id) => id === "bulk-1")).toHaveLength(1);
  expect(state.writes.filter((id) => id === "bulk-2")).toHaveLength(2);
  await page.reload();
  await page.getByRole("button", { name: "消去済み 3件", exact: true }).click();
  await expect(page.getByRole("button", { name: "表示に戻す", exact: true })).toHaveCount(3);
  await page.getByLabel("確認者名", { exact: true }).fill("操作試験");
  await page.getByRole("button", { name: "表示に戻す", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "表示中 1件", exact: true })).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test("changing tabs clears selection and selected cards remain usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole("checkbox", { name: "試験生徒1の連絡を選択" }).check();
  await expect(page.getByRole("button", { name: "選択した1件の表示を消す" })).toBeVisible();
  await page.screenshot({ path: "test-results/attendance-bulk-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "すべて 3件", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "表示中 3件", exact: true }).click();
  await page.getByRole("button", { name: "複数選択", exact: true }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
});
