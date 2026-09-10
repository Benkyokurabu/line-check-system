import { expect, test, type Page } from "@playwright/test";
async function setup(page: Page, empty = false) {
  const student = { student_number: "2018999", student_name: "検証用 工藤謙", campus: "本校", grade: "中3", homeroom_teacher: "検証用" };
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `day-${i}`, event_date: `2099-09-${11 + i}`, event_type: "absence", status: "pending", ai_summary: "検証用", student_number: null }));
  const lessons = [11, 18].map((day) => ({ id: `lesson-${day}`, lesson_date: `2099-09-${day}`, campus: "本校", label: "中3 A 数学", subject: "数学", class_name: "A", enrolled: true, start_time: "18:00" }));
  const state = { writes: [] as Record<string, unknown>[], confirms: 0, failed: false, rangeReads: 0, savedRows: null as Record<string, unknown>[] | null };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3197") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname;
    if (path === "/api/attendance/students") return route.fulfill({ json: { students: [student] } });
    if (path === "/api/attendance/candidates") return route.fulfill({ json: { candidates: [{ id: "auto", student_number: student.student_number, student_roster: student, status: state.savedRows ? "notion_failed" : "pending", event_type: "absence", event_date: "2099-09-11", ai_summary: "検証用", attendance_candidate_items: state.savedRows ?? rows, line_messages: { text: "9月11日から18日まで欠席します", display_name: "検証用 工藤謙" } }] } });
    if (path === "/api/attendance/lessons") {
      if (url.searchParams.has("date_from")) { state.rangeReads++; expect(url.searchParams.get("date_from")).toBe("2099-09-11"); expect(url.searchParams.get("date_to")).toBe("2099-09-18"); }
      return route.fulfill({ json: { lessons: empty ? [] : lessons } });
    }
    if (path === "/api/attendance/candidates/auto") { expect(route.request().method()).toBe("PATCH"); state.writes = route.request().postDataJSON().items; return route.fulfill({ json: { ok: true } }); }
    if (path.endsWith("/confirm")) {
      state.confirms++;
      if (state.failed) {
        state.savedRows = state.writes.map((row, i) => ({ ...row, id: `saved-${i}`, status: i === 0 ? "confirmed" : "notion_failed", lessons: lessons[i] }));
        return route.fulfill({ status: 502, json: { error: "一部のNotion登録に失敗しました" } });
      }
      return route.fulfill({ json: { notion_page_ids: ["test-1", "test-2"] } });
    }
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: {} });
  });
  await page.goto("/attendance");
  await page.getByLabel("確認者名", { exact: true }).fill("工藤");
  await page.getByRole("button", { name: "対応する", exact: true }).click();
  return state;
}
test("opening a period proposes actual lessons and a single action registers all selected lessons", async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByRole("button", { name: "この2授業をまとめて欠席登録" })).toBeVisible();
  expect(state.writes).toHaveLength(0); expect(state.confirms).toBe(0); expect(state.rangeReads).toBe(1);
  await expect(page.getByRole("button", { name: "確認してNotionへ登録", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/auto-period-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "この2授業をまとめて欠席登録" }).click();
  await expect(page.getByText("Notionへ登録しました。", { exact: true })).toBeVisible();
  expect(state.writes.map((row) => [row.event_date, row.lesson_id, row.student_number])).toEqual([["2099-09-11", "lesson-11", "2018999"], ["2099-09-18", "lesson-18", "2018999"]]);
  expect(state.confirms).toBe(1);
});
test("unchecked lessons are excluded and zero selections cannot register", async ({ page }) => {
  const state = await setup(page);
  const checks = page.getByRole("group", { name: "期間の欠席をまとめて登録" }).getByRole("checkbox");
  await checks.first().uncheck(); await checks.last().uncheck();
  await expect(page.getByRole("button", { name: "この0授業をまとめて欠席登録" })).toBeDisabled();
  await checks.last().check();
  await page.getByRole("button", { name: "この1授業をまとめて欠席登録" }).click();
  await expect(page.getByText("Notionへ登録しました。", { exact: true })).toBeVisible();
  expect(state.writes.map((row) => row.lesson_id)).toEqual(["lesson-18"]);
});
test("no enrolled lessons gives a manual escape with no writes", async ({ page }) => {
  const state = await setup(page, true);
  await expect(page.getByText(/対象の授業が見つかりません/)).toBeVisible();
  await page.getByRole("button", { name: "日付・授業を自分で修正" }).click();
  await expect(page.getByRole("button", { name: "確認してNotionへ登録", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0); expect(state.confirms).toBe(0);
});

test("partial failure reloads saved row IDs and preserves the confirmed row on retry", async ({ page }) => {
  const state = await setup(page);
  state.failed = true;
  await page.getByRole("button", { name: "この2授業をまとめて欠席登録" }).click();
  await expect(page.getByText("一部のNotion登録に失敗しました", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "この2授業をまとめて欠席登録" })).toHaveCount(0);
  state.failed = false;
  await page.getByRole("button", { name: "確認してNotionへ登録", exact: true }).click();
  await expect(page.getByText("Notionへ登録しました。", { exact: true })).toBeVisible();
  expect(state.writes.map((row) => row.id)).toEqual(["saved-0", "saved-1"]);
});

test("bulk type can switch both ways without reloading lessons and writes the chosen type", async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByRole("button", { name: "この2授業をまとめて欠席登録" })).toBeVisible();
  const type = page.getByLabel("まとめて登録する種別");
  await type.selectOption("late");
  await expect(page.getByRole("button", { name: "この2授業をまとめて遅刻登録" })).toBeVisible();
  await expect(page.getByLabel("まとめて登録する理由")).toHaveValue("検証用");
  await page.getByLabel("まとめて登録する理由").fill("遅刻連絡");
  await type.selectOption("absence");
  await expect(page.getByLabel("まとめて登録する理由")).toHaveValue("欠席連絡");
  await type.selectOption("late");
  await expect(page.getByLabel("まとめて登録する理由")).toHaveValue("遅刻連絡");
  expect(state.rangeReads).toBe(1);
  expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "この2授業をまとめて遅刻登録" }).click();
  await expect(page.getByText("Notionへ登録しました。", { exact: true })).toBeVisible();
  expect(state.writes.map((row) => [row.event_type, row.ai_summary])).toEqual([["late", "遅刻連絡"], ["late", "遅刻連絡"]]);
});

test("manual editing can return to the proposal with type and selected lessons preserved", async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByRole("button", { name: "この2授業をまとめて欠席登録" })).toBeVisible();
  await page.getByLabel("まとめて登録する種別").selectOption("late");
  await page.getByRole("group", { name: "期間の遅刻をまとめて登録" }).getByRole("checkbox").first().uncheck();
  await page.getByRole("button", { name: "日付・授業を自分で修正" }).click();
  await expect(page.getByRole("button", { name: "確認してNotionへ登録", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "授業の自動提案に戻る" }).click();
  await expect(page.getByRole("button", { name: "この1授業をまとめて遅刻登録" })).toBeVisible();
  await expect(page.getByLabel("まとめて登録する種別")).toHaveValue("late");
  expect(state.rangeReads).toBe(1);
  expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "この1授業をまとめて遅刻登録" }).click();
  await expect(page.getByText("Notionへ登録しました。", { exact: true })).toBeVisible();
  expect(state.writes.map((row) => [row.lesson_id, row.event_type])).toEqual([["lesson-18", "late"]]);
});
