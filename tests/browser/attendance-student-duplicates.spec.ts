import { expect, test } from "@playwright/test";
import { selectConfirmer } from "./confirmer-helper";
import { setupRegistration } from "./registration-fixture";
import { buildStudentSearchOptions, canonicalStudentSuggestions } from "../../src/lib/student-search-options.mjs";

test("verified old Notion records show one candidate and keep the confirmed student selected", async ({ page }) => {
  const { writes } = await setupRegistration(page);
  const current = { student_number: "UI-ONE", student_name: "試験 一 郎", grade: "中3", campus: "南教室", source_file: "中3クラス一覧表.xlsx" };
  const rows = [current, { ...current, student_number: "OLD", student_name: "試験　一郎", source_file: "Notion生徒情報DB" }, { ...current, student_number: "notion:page", student_name: "試験　一郎", source_file: "Notion生徒情報DB" }];
  const options = buildStudentSearchOptions(rows, [{ from: "OLD", to: "UI-ONE", verified: true }, { from: "notion:page", to: "UI-ONE", verified: true }]);
  await page.route("**/api/attendance/students", route => route.fulfill({ json: { students: options } }));
  await page.route("**/api/attendance/candidates?**", route => route.fulfill({ json: { candidates: [{
    id: "duplicate-test", student_number: "UI-ONE", student_roster: current, status: "pending", event_type: "absence", event_date: "2099-10-02", ai_summary: "欠席", student_selection_required: false,
    student_suggestions: canonicalStudentSuggestions(rows.map((row, i) => ({ ...row, score: 110 - i * 10, reason: "候補" })), options),
    sender_profile: { display_name: "登録試験LINE", alias_names: ["南　試験一郎"], account_names: [], student_accounts: [] },
    line_messages: { id: "ui-evidence", line_user_id: "ui-line", display_name: "登録試験LINE", text: "欠席します" },
  }] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/attendance");
  await page.getByRole("button", { name: "対応する", exact: true }).click();
  const candidates = page.getByRole("group", { name: "連絡した生徒の候補" });
  await expect(candidates.getByRole("button")).toHaveCount(1);
  await expect(candidates.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(candidates.getByRole("button")).toContainText("選択中：中3 試験 一 郎");
  await expect(candidates.getByRole("button")).toContainText("南教室 / 生徒番号 UI-ONE");
  await expect(page.getByText("今回の連絡の対象生徒", { exact: true })).toBeVisible();
  await candidates.getByRole("button").click();
  await page.waitForTimeout(1200);
  expect(writes).toHaveLength(0);
  await page.reload();
  await page.getByRole("button", { name: "対応する", exact: true }).click();
  await expect(candidates.getByRole("button")).toHaveCount(1);
  expect(writes).toHaveLength(0);
});

test("editing a name again clears the previous saved confirmation", async ({ page }) => {
  const { writes } = await setupRegistration(page, { relation: "mother" });
  await page.goto("/attendance");
  await page.getByRole("link", { name: "勉たんの名前を直す", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "LINE登録・修正", exact: true });
  const input = dialog.getByLabel("勉たんに表示する名前");
  await input.fill("保存した名前");
  await selectConfirmer(page, "確認職員");
  await dialog.getByRole("button", { name: "この名前で保存", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "保存しました。欠席確認に戻る", exact: true })).toBeVisible();
  await input.fill("まだ保存していない名前");
  await expect(dialog.getByRole("button", { name: "保存しました。欠席確認に戻る", exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(1);
});
