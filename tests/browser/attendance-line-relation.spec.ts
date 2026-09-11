import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  const writes: Record<string, unknown>[] = [];
  const student = { student_number: "relation-test", student_name: "続柄試験", grade: "中1", campus: "本校" };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/attendance/students") return route.fulfill({ json: { students: [student] } });
    if (path === "/api/attendance/candidates") return route.fulfill({ json: { candidates: [{
      id: "relation-candidate", student_number: student.student_number, student_roster: student,
      status: "pending", event_type: "absence", event_date: "2099-09-11", ai_summary: "欠席",
      line_messages: { line_user_id: "test-line-user", display_name: "続柄試験", text: "欠席します" },
    }] } });
    if (path === "/api/students/relation-test/link") {
      expect(route.request().method()).toBe("PUT"); writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: {} });
  });
  await page.goto("/attendance");
  await page.getByRole("button", { name: "対応する", exact: true }).click();
  return writes;
}

for (const [label, relation, primary] of [["生徒本人", "student", true], ["保護者", "guardian", false]] as const) {
  test(`${label} registration uses the chosen relation and primary setting`, async ({ page }) => {
    const writes = await setup(page);
    page.on("dialog", async (dialog) => { expect(dialog.message()).toContain(`${label}のLINEとして登録`); await dialog.accept(); });
    await page.getByRole("button", { name: `このLINEを${label}として登録`, exact: true }).click();
    await expect(page.getByText(`選択中の生徒へ${label}のLINEとして登録しました。`, { exact: true })).toBeVisible();
    expect(writes).toEqual([{ line_user_id: "test-line-user", relation, is_primary: primary, alias_name: "続柄試験", friend_display_name: "続柄試験" }]);
  });
}

test("cancelling student registration sends no update", async ({ page }) => {
  const writes = await setup(page);
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "このLINEを生徒本人として登録", exact: true }).click();
  expect(writes).toHaveLength(0);
});
