import { expect, test, type Page } from "@playwright/test";
const student = { student_number: "period-student", student_name: "期間試験生徒", grade: "中1", campus: "南教室", homeroom_teacher: "試験担任" };
const lessons = [
  { id: "period-lesson-1", lesson_date: "2099-01-01", start_time: "18:00", campus: "南教室", label: "数学", enrolled: true, enrollment_campus: "南教室" },
  { id: "period-lesson-2", lesson_date: "2099-01-03", start_time: "18:00", campus: "南教室", label: "英語", enrolled: true, enrollment_campus: "南教室" },
];
async function setup(page: Page, line = false) {
  const state = { writes: [] as Record<string, unknown>[], failId: "", rangeReads: 0, savedItems: [] as Record<string, unknown>[] };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3197") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname;
    if (path === "/api/attendance/students") return route.fulfill({ json: { students: [student] } });
    if (path === "/api/attendance/lessons") {
      if (url.searchParams.has("date_from")) {
        state.rangeReads++;
        expect(url.searchParams.get("student_number")).toBe(student.student_number);
        return route.fulfill({ json: { lessons } });
      }
      return route.fulfill({ json: { lessons: lessons.filter((row) => row.lesson_date === url.searchParams.get("date")) } });
    }
    if (path === "/api/attendance/candidates" && route.request().method() === "GET") return route.fulfill({ json: { candidates: line ? [{
      id: "period-candidate", status: "pending", event_type: "absence", event_date: "2099-01-01", ai_confidence: 1, ai_summary: "体調不良",
      student_number: student.student_number, student_roster: student, lessons: null, review_hidden_at: null,
      line_messages: { text: "期間中は欠席します", received_at: "2099-01-01T00:00:00Z", display_name: "試験保護者" },
    }] : [] } });
    if (path === "/api/attendance/candidates/period-candidate" && route.request().method() === "PATCH") {
      state.savedItems = route.request().postDataJSON().items;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/confirm")) return route.fulfill({ json: { notion_page_ids: ["test-1", "test-2"] } });
    if (path === "/api/attendance/events" && route.request().method() === "POST") {
      const body = route.request().postDataJSON(); state.writes.push(body);
      if (body.lesson_id === state.failId) return route.fulfill({ json: { notion_failed: 1, notion_results: [{ notion_error: "試験用のエラー" }] } });
      return route.fulfill({ json: { ok: true, notion_failed: 0 } });
    }
    if (route.request().method() !== "GET") throw new Error(`Unexpected mutation: ${path}`);
    return route.fulfill({ json: {} });
  });
  await page.goto("/attendance");
  await page.getByLabel("確認者名", { exact: true }).fill("操作試験");
  if (line) {
    await page.getByRole("button", { name: "対応する", exact: true }).click();
    await page.getByRole("button", { name: "期間を指定して登録行を作る" }).click();
  } else {
    await page.getByRole("button", { name: "電話・口頭連絡を手入力", exact: true }).click();
    await page.getByRole("button", { name: "期間を指定して登録", exact: true }).click();
    await page.getByRole("combobox", { name: "生徒", exact: true }).fill(student.student_name);
    await page.getByRole("option", { name: /期間試験生徒/ }).click();
  }
  await page.getByLabel("開始日", { exact: true }).fill("2099-01-01");
  await page.getByLabel("終了日", { exact: true }).fill("2099-01-03");
  await page.getByRole("button", { name: "期間内の授業を表示", exact: true }).click();
  await expect(page.getByText("2日・2授業を選択中", { exact: true })).toBeVisible();
  return state;
}

test("manual period registration maps actual dates and lessons and retries only failed Notion entries", async ({ page }) => {
  const state = await setup(page);
  await page.getByRole("combobox", { name: "種別", exact: true }).selectOption("late");
  state.failId = lessons[1].id;
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "選択した2授業を登録", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1授業を登録しました。1授業は" })).toBeVisible();
  expect(state.writes.map((row) => [row.lesson_id, row.event_date, row.event_type])).toEqual(lessons.map((lesson) => [lesson.id, lesson.lesson_date, "late"]));
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(1);
  state.failId = "";
  await page.getByRole("button", { name: "選択した1授業を登録", exact: true }).click();
  await expect(page.getByText("手入力の欠席・遅刻を登録しました。", { exact: true })).toBeVisible();
  expect(state.writes.filter((row) => row.lesson_id === lessons[0].id)).toHaveLength(1);
});

test("changing dates invalidates preview and reversed ranges cannot submit", async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel("終了日", { exact: true }).fill("2098-12-31");
  await expect(page.getByRole("button", { name: "選択した0授業を登録" })).toBeDisabled();
  await page.getByRole("button", { name: "期間内の授業を表示", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("終了日は開始日以降");
  expect(state.rangeReads).toBe(1);
  expect(state.writes).toHaveLength(0);
});

test("LINE period preview creates editable rows and only explicit confirmation registers them", async ({ page }) => {
  const state = await setup(page, true);
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByLabel("期間内の種別").selectOption("late");
  await page.getByLabel("期間内の理由").fill("期間中の学校行事");
  await page.screenshot({ path: "test-results/attendance-period.png", fullPage: true });
  await page.getByRole("button", { name: "2授業の登録行を作る" }).click();
  expect(state.savedItems).toHaveLength(0);
  await page.getByRole("button", { name: "確認してNotionへ登録", exact: true }).click();
  await expect(page.getByText("Notionへ登録しました。", { exact: true })).toBeVisible();
  expect(state.savedItems.map((row) => [row.lesson_id, row.event_date, row.event_type, row.ai_summary])).toEqual(lessons.map((lesson) => [lesson.id, lesson.lesson_date, "late", "期間中の学校行事"]));
});
