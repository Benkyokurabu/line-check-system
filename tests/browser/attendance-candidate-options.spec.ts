import { expect, test } from "@playwright/test";
import { setupRegistration } from "./registration-fixture";

for (const mode of ["single", "siblings", "conflict", "reviewed"]) test(`candidate alternatives remain accessible: ${mode}`, async ({ page }) => {
  const { writes } = await setupRegistration(page);
  const one = { student_number: "UI-ONE", student_name: "試験一郎", grade: "中1", campus: "本校", homeroom_teacher: "試験先生", score: 110, reason: "確認済みLINE登録" };
  const two = { ...one, student_number: "UI-TWO", student_name: "試験二郎", score: 90, reason: "未確認LINE候補" };
  await page.route("**/api/attendance/candidates?**", route => route.fulfill({ json: { candidates: [{
    id: "options-test", student_number: mode === "reviewed" ? "UI-TWO" : "UI-ONE", student_roster: mode === "reviewed" ? two : one,
    status: "pending", event_type: "absence", event_date: "2099-10-02", ai_summary: "欠席",
    human_reviewed_at: mode === "reviewed" ? "2026-10-16T00:00:00Z" : null,
    student_selection_required: mode === "conflict", student_suggestions: [one, two],
    sender_profile: { display_name: "登録試験LINE", alias_names: [], account_names: [], student_accounts: (mode === "siblings" ? [one, two] : [one]).map(student => ({ student_number: student.student_number, relation: "mother" })) },
    line_messages: { id: "ui-evidence", line_user_id: "ui-line", display_name: "登録試験LINE", text: mode === "conflict" ? "試験二郎が欠席します" : "欠席します" },
  }] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/attendance");
  await page.getByRole("button", { name: "対応する", exact: true }).click();
  const group = page.getByRole("group", { name: "連絡した生徒の候補" });
  if (mode === "single") {
    await expect(group.getByRole("button")).toHaveCount(1);
    await group.getByText("ほかの候補を確認（1名）", { exact: true }).click();
    await expect(group.getByRole("button")).toHaveCount(2);
    await expect(group.getByText("過去の紐付け候補（未確認）", { exact: true })).toBeVisible();
  } else {
    await expect(group.getByRole("button")).toHaveCount(2);
    await expect(group.locator("details")).toHaveCount(0);
  }
  expect(writes).toHaveLength(0);
});
