import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  const candidate = { id: "11111111-1111-4111-8111-111111111111", status: "confirmed", event_type: "absence", event_date: "2099-01-01", ai_confidence: 1,
    review_hidden_at: null as string | null, review_hidden_by: null as string | null, student_number: null, student_roster: null, lessons: null,
    attendance_candidate_items: [], reply_messages: [], line_messages: { text: "表示切替の試験用連絡", received_at: new Date().toISOString(), display_name: "試験用" } };
  const state = { fail: false, writes: 0 };
  await page.route("**/api/attendance/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/visibility")) {
      state.writes++;
      expect(route.request().method()).toBe("PATCH");
      const body = route.request().postDataJSON();
      expect(body.changed_by).toBe("操作試験");
      if (state.fail) return route.fulfill({ status: 500, json: { error: "保存に失敗しました。再試行してください。" } });
      candidate.review_hidden_at = body.hidden ? new Date().toISOString() : null;
      candidate.review_hidden_by = body.hidden ? body.changed_by : null;
      return route.fulfill({ json: { candidate } });
    }
    expect(route.request().method()).toBe("GET");
    if (path.endsWith("/candidates")) return route.fulfill({ json: { candidates: [candidate] } });
    if (path.endsWith("/students")) return route.fulfill({ json: { students: [] } });
    if (path.endsWith("/reply-templates")) return route.fulfill({ json: { templates: ["確認しました。"] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/attendance");
  await expect(page.getByRole("button", { name: "表示を消す", exact: true })).toBeVisible();
  return state;
}

test("a collapsed card shows the missing reviewer instruction without sending a request", async ({ page }) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "表示を消す", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "画面上部の「確認者名」を入力してください。" })).toBeVisible();
  await expect(page.getByRole("button", { name: "内容を見る", exact: true })).toHaveAttribute("aria-expanded", "false");
  expect(state.writes).toBe(0);
});

test("collapsed cards show save errors, retry, move to hidden and restore across reloads", async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel("確認者名", { exact: true }).fill("操作試験");
  page.on("dialog", (dialog) => dialog.accept());
  state.fail = true;
  await page.getByRole("button", { name: "表示を消す", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "保存に失敗しました。再試行してください。" })).toBeVisible();
  state.fail = false;
  await page.getByRole("button", { name: "表示を消す", exact: true }).click();
  await expect(page.getByRole("button", { name: "表示を消す", exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "消去済み 1件", exact: true }).click();
  await expect(page.getByRole("button", { name: "表示に戻す", exact: true })).toBeVisible();
  await page.getByLabel("確認者名", { exact: true }).fill("操作試験");
  await page.getByRole("button", { name: "表示に戻す", exact: true }).click();
  await expect(page.getByRole("button", { name: "表示中 1件", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "表示を消す", exact: true })).toBeVisible();
  expect(state.writes).toBe(3);
});

test("canceling the confirmation keeps the card visible", async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel("確認者名", { exact: true }).fill("操作試験");
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "表示を消す", exact: true }).click();
  await expect(page.getByRole("button", { name: "表示を消す", exact: true })).toBeEnabled();
  expect(state.writes).toBe(0);
});
