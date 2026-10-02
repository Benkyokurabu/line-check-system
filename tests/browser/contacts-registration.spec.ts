import { expect, test } from "@playwright/test";
import { setupRegistration } from "./registration-fixture";
for (const staff of [false, true]) test(`contacts register in the dedicated page; staff=${staff}`, async ({ page }) => {
  const { writes } = await setupRegistration(page, { linked: false });
  await page.goto("/contacts");
  await page.getByLabel("操作するスタッフ名").fill("試験職員");
  await page.getByRole("link", { name: staff ? "先生・スタッフとして登録" : "生徒本人・保護者を登録", exact: true }).click();
  await expect(page).toHaveURL(/\/line-registration\?/);
  const form = page.getByRole("region", { name: "生徒本人・保護者のLINE登録", exact: true });
  page.on("dialog", dialog => dialog.accept());
  if (staff) {
    await expect(form.getByLabel("先生・スタッフの登録名")).toHaveValue("旧登録名");
    await form.getByLabel("先生・スタッフの登録名").fill("試験先生");
    await form.getByRole("button", { name: "先生・スタッフとして保存して一覧を更新" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ path: "/api/admin/contacts/ui-line", body: { alias_name: "試験先生", group_name: "スタッフ" } });
  } else {
    await form.getByRole("button", { name: "生徒本人", exact: true }).click();
    await form.getByLabel("生徒を検索", { exact: true }).fill("試験一郎");
    await form.getByRole("button", { name: /UI-ONE/ }).click();
    await expect(form.getByRole("button", { name: "この内容で登録して一覧の名前を更新" })).toBeDisabled();
    await form.getByRole("button", { name: "試験一郎と試験二郎の保護者です。", exact: true }).click();
    await form.getByRole("button", { name: "この内容で登録して一覧の名前を更新" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body).toMatchObject({ verified_by: "試験職員", source: "contacts_review", evidence_message_id: "ui-evidence" });
  }
  if (!staff) await expect(page.getByText(/^現在の確認済み紐付け：/)).toContainText("試験一郎");
  await page.getByRole("button", { name: "保存しました。連絡先管理に戻る", exact: true }).click();
  await expect(page).toHaveURL(/\/contacts$/);
});
test("contact alias edit preserves search and does not change group or links", async ({ page }) => {
  const { writes } = await setupRegistration(page, { linked: false });
  await page.goto("/contacts");
  await page.locator("#contact-search").fill("登録試験LINE");
  await page.getByRole("link", { name: "登録名編集", exact: true }).click();
  await page.getByLabel("勉たんに表示する名前").fill("家族の共通名");
  await page.getByRole("button", { name: "この名前で保存", exact: true }).click();
  await page.getByRole("button", { name: "保存しました。連絡先管理に戻る", exact: true }).click();
  await expect(page.locator("#contact-search")).toHaveValue("登録試験LINE");
  await expect(page.getByRole("row").filter({ hasText: "登録試験LINE" })).toContainText("家族の共通名");
  expect(writes).toEqual([{ path: "/api/admin/contacts/ui-line", body: { alias_name: "家族の共通名" } }]);
});
