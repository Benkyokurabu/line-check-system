import { expect, test } from "@playwright/test";
import { setupRegistration } from "./registration-fixture";
import { selectConfirmer } from "./confirmer-helper";

const history = [
  { id: "name:1", kind: "name", action: "updated", actor: "確認先生", created_at: "2026-10-16T09:00:00Z", before_value: { alias_name: "旧表示名" }, after_value: { alias_name: "新表示名" } },
  { id: "registration:2", kind: "registration", action: "updated", actor: "登録先生", created_at: "2026-10-16T08:00:00Z", before_value: { student_name: "試験一郎", relation: "student" }, after_value: { student_name: "試験二郎", relation: "mother" } },
  { id: "attendance:3", kind: "attendance", action: "updated", actor: "受付先生", created_at: "2026-10-16T07:00:00Z", message_text: "二郎が欠席します", before_value: { student_name: "試験一郎", lessons: [] }, after_value: { student_name: "試験二郎", lessons: [{ lesson_id: "lesson" }] } },
];
for (const surface of ["attendance", "workspace", "contacts"]) test(`unified history is readable and retryable on mobile: ${surface}`, async ({ page }) => {
  const { writes } = await setupRegistration(page);
  let attempts = 0;
  await page.route("**/api/admin/contacts/ui-line/history**", route => {
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 500, json: { error: "履歴の取得に失敗しました" } }) : route.fulfill({ json: { history } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(surface === "workspace" ? "/line-registration?userId=ui-line&mode=name" : `/${surface}`);
  if (surface === "attendance") await page.getByRole("button", { name: "対応する", exact: true }).click();
  if (surface === "contacts") {
    await page.locator("#contact-search").fill("登録試験LINE");
    await page.getByRole("button", { name: "メッセージ・履歴", exact: true }).click();
  }
  const region = page.getByRole("region", { name: "登録・対象生徒の変更履歴", exact: true });
  await region.getByRole("button", { name: "登録・対象生徒の変更履歴", exact: true }).click();
  await expect(region.getByRole("alert")).toContainText("履歴の取得に失敗しました");
  await region.getByRole("button", { name: "履歴の取得を再試行" }).click();
  await expect(region.getByText("表示名の変更", { exact: true })).toBeVisible();
  await expect(region.getByText("変更前：旧表示名", { exact: true })).toBeVisible();
  await expect(region.getByText("変更後：新表示名", { exact: true })).toBeVisible();
  await expect(region.getByText("LINE登録先の変更", { exact: true })).toBeVisible();
  await expect(region.getByText("連絡の対象生徒・授業の変更", { exact: true })).toBeVisible();
  await expect(region.getByText("変更後：試験二郎 / 授業 1件", { exact: true })).toBeVisible();
  await expect(region.getByText(/受付先生/)).toBeVisible();
  expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(writes).toHaveLength(0);
});

for (const reject of [false, true]) test(`parent display-name edits include the actor and preserve failure state: ${reject}`, async ({ page }) => {
  const { writes } = await setupRegistration(page, { relation: "mother", reject });
  await page.goto("/line-registration?userId=ui-line&mode=name");
  await page.getByLabel("勉たんに表示する名前").fill("新しい保護者名");
  await expect(page.getByRole("button", { name: "この名前で保存", exact: true })).toBeDisabled();
  await selectConfirmer(page, "確認職員");
  await page.getByRole("button", { name: "この名前で保存", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toEqual({ alias_name: "新しい保護者名", performed_by: "確認職員" });
  if (reject) { await expect(page.getByRole("status")).toContainText("保存できませんでした"); await expect(page.getByLabel("勉たんに表示する名前")).toHaveValue("新しい保護者名"); await expect(page.getByRole("button", { name: /保存しました。/ })).toHaveCount(0); }
});
